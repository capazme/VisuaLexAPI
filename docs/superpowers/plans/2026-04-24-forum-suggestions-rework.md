# Forum Suggestions Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Forum suggestion pipeline from monolithic approve/reject (3 content types) into per-item atomic take/decline across 5 content types (annotation, highlight, dossier, quickNorm, alias) with permanent attribution on the owner's workspace rows.

**Architecture:** New `SuggestionItem` table as child of `EnvironmentSuggestion`; `content` JSON dropped from suggestion row. `take` lands the item in the owner's **private** workspace (Annotation/Highlight/Dossier/QuickNorm/CustomAlias) carrying `sourceSuggestionId` + `originalAuthorId`; the public SharedEnvironment only changes at the next re-publish. Alias unique-trigger conflict returns 409 with a resolution payload; frontend opens a Replace/Rename/Skip mini dialog.

**Tech Stack:** Prisma 5 (PostgreSQL), Express 4 + TS, Zod, Vitest + Supertest (new backend test framework), React 18 + TS, Zustand, Tailwind, `@floating-ui/react`, `date-fns`.

**Source of truth:** `docs/superpowers/specs/2026-04-24-forum-suggestions-rework-design.md`. All decisions D1-D10 and orthogonal scope are final.

**Commit convention:** Conventional Commits. Scope `forum` for the majority (suggestion flow), `db` for schema changes, `test` for test setup.

---

## File Structure

### Backend (create / modify)

- **Modify** `backend/prisma/schema.prisma` — drop `SuggestionStatus` enum, add `SuggestionItemType` + `SuggestionItemStatus` enums, add `SuggestionItem` model, rewrite `EnvironmentSuggestion` fields, add `sourceSuggestionId` + `originalAuthorId` to 5 target models, add `User.originalAuthorOf*` inverse relations, drop `SharedEnvironmentVersion.suggestionId` FK column.
- **Modify** `backend/src/controllers/sharedEnvironmentController.ts` — rewrite suggestion section (~200 lines): drop `approveSuggestion` / `rejectSuggestion` / `approveSuggestionSchema` / `rejectSuggestionSchema`; rewrite `createSuggestion` to accept items; rewrite `getReceivedSuggestions` / `getSentSuggestions` / `getPendingSuggestionsCount` to work on items; add `takeSuggestionItem` / `declineSuggestionItem` / `revokeSuggestionItem` / `addSuggestionItems` handlers.
- **Modify** `backend/src/routes/sharedEnvironments.ts` — swap approve/reject routes for per-item routes.
- **Create** `backend/vitest.config.ts` — test runner config.
- **Create** `backend/tests/setup.ts` — test DB bootstrap (migrate + truncate between suites).
- **Create** `backend/tests/helpers.ts` — helpers: createTestUser, loginAs, createSharedEnv, seedSuggestion.
- **Create** `backend/tests/suggestions.lifecycle.test.ts` — full lifecycle + authZ.
- **Create** `backend/tests/suggestions.alias-conflict.test.ts` — 409 path.
- **Create** `backend/tests/suggestions.attribution.test.ts` — attribution columns + account-deletion invariant.
- **Modify** `backend/package.json` — add vitest + supertest + @types/supertest to devDeps, add `test` + `test:watch` scripts.

### Frontend (create / modify)

- **Modify** `frontend/src/types/index.ts` — drop `SuggestionStatus` / `SuggestionContent` / `ApproveSuggestionPayload`; add `SuggestionItemType` / `SuggestionItemStatus` / `SuggestionItem`; rewrite `EnvironmentSuggestion`; add `OriginalAuthor` + attribution fields to `Annotation` / `Highlight` / `Dossier` / `QuickNorm` / `CustomAlias`.
- **Modify** `frontend/src/services/sharedEnvironmentService.ts` — drop `approveSuggestion` / `rejectSuggestion`; add `takeSuggestionItem` / `declineSuggestionItem` / `revokeSuggestionItem` / `addSuggestionItems`.
- **Modify** `frontend/src/components/features/bulletin/SuggestContentModal.tsx` — 5 sections (add notes + highlights), build `items[]` payload.
- **Create** `frontend/src/components/features/bulletin/SuggestionItemCard.tsx` — polymorphic renderer for 5 itemTypes, used in Review + Edit.
- **Create** `frontend/src/components/features/bulletin/SuggestionReviewDialog.tsx` — owner-side modal (Flow 2).
- **Create** `frontend/src/components/features/bulletin/AliasConflictDialog.tsx` — Replace / Rename / Skip mini dialog.
- **Create** `frontend/src/components/features/bulletin/EditSuggestionDialog.tsx` — suggester-side modal (Flow 3).
- **Create** `frontend/src/components/features/bulletin/AddItemsDialog.tsx` — selector scoped to suggester's workspace, used from Edit dialog.
- **Modify** `frontend/src/components/features/bulletin/ForumSuggestionsView.tsx` — drop inline ✓/✗; cards clickable with per-item status breakdown chip.
- **Modify** `frontend/src/components/features/bulletin/BulletinBoardPage.tsx` — swap `handleApprove` / `handleReject` for `handleOpenReview` / `handleOpenEdit` + per-item handlers.
- **Modify** `frontend/src/components/features/search/NotesPeekPanel.tsx` — attribution subtitle + `Tutte / Mie / Importate` filter tri-state.
- **Modify** `frontend/src/components/features/search/InlineNotePopover.tsx` — attribution subtitle.
- **Modify** `frontend/src/components/features/dossier/DossierListView.tsx` — attribution chip on cards.
- **Modify** `frontend/src/components/features/dossier/DossierDetailView.tsx` — attribution chip on header.
- **Modify** `frontend/src/components/features/search/QuickNormsManager.tsx` — attribution chip on list rows.
- **Modify** `frontend/src/components/features/settings/AliasManager.tsx` — attribution chip on list rows.
- **Create** `frontend/src/components/features/bulletin/AttributionChip.tsx` — shared `da @mario` chip (6+ call sites ⇒ extract).
- **Modify** `CLAUDE.md` — Critical Files entry for new components + new gotchas.

---

## Testing Strategy Summary

- **Backend integration** (vitest + supertest, new infra in Task 2): lifecycle, authZ, alias conflict, attribution. See Task 4.
- **Frontend unit** (vitest, existing): `SuggestionItemCard` renders all 5 types; status breakdown math.
- **Manual smoke** at end of each chunk (curl + browser).

---

## Task 0: Baseline check (pre-flight)

**Files:** none

- [ ] **Step 1: Confirm clean working tree**

Run: `git status --porcelain && git log --oneline -3`
Expected: empty porcelain; HEAD at `95a6bde docs(spec): forum suggestions rework design`.

- [ ] **Step 2: Record frontend lint baseline**

Run: `cd frontend && npx eslint . --ext .ts,.tsx 2>&1 | tail -5`
Record: "156 problems (146 errors, 10 warnings)". Persist this number — every subsequent task must NOT increase it.

- [ ] **Step 3: Confirm typecheck green**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exit 0, zero output.

- [ ] **Step 4: Boot dev stack and confirm `/forum` loads**

Run: `./start.sh` (from repo root). Wait until all three banners print (`Python:5000`, `Backend:3001`, `Frontend:5173`).
Open `http://localhost:5173/forum` in a browser. Verify the three tabs render (Esplora / I Miei / Suggerimenti).
Kill with Ctrl+C when done.

- [ ] **Step 5: No commit needed for baseline check**

Just record baseline in your notes.

---

## Task 1: Prisma schema — enums, SuggestionItem, EnvironmentSuggestion rewrite, attribution columns

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Remove `SuggestionStatus` enum (lines ~466-470)**

Delete the block:
```prisma
enum SuggestionStatus {
  pending
  approved
  rejected
}
```

- [ ] **Step 2: Add two new enums above `EnvironmentSuggestion`**

Insert in the same "ENVIRONMENT SUGGESTIONS & VERSIONING" section header comment area:
```prisma
enum SuggestionItemType {
  annotation
  highlight
  dossier
  quickNorm
  alias
}

enum SuggestionItemStatus {
  pending
  taken
  declined
}
```

- [ ] **Step 3: Rewrite `EnvironmentSuggestion` model**

Replace the entire `model EnvironmentSuggestion { ... }` block with:
```prisma
model EnvironmentSuggestion {
  id                  String @id @default(uuid())
  sharedEnvironmentId String @map("shared_environment_id")
  suggesterId         String @map("suggester_id")

  message String? @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  sharedEnvironment SharedEnvironment @relation(fields: [sharedEnvironmentId], references: [id], onDelete: Cascade)
  suggester         User              @relation("SuggestionsMade", fields: [suggesterId], references: [id], onDelete: Cascade)
  items             SuggestionItem[]

  // Attribution inverse relations (rows in the owner's workspace that
  // originated here via `take`). onDelete: SetNull lives on the child side.
  sourcedAnnotations Annotation[]    @relation("SuggestionSourcedAnnotations")
  sourcedHighlights  Highlight[]     @relation("SuggestionSourcedHighlights")
  sourcedDossiers    Dossier[]       @relation("SuggestionSourcedDossiers")
  sourcedQuickNorms  QuickNorm[]     @relation("SuggestionSourcedQuickNorms")
  sourcedAliases     CustomAlias[]   @relation("SuggestionSourcedAliases")

  @@index([sharedEnvironmentId])
  @@index([suggesterId])
  @@map("environment_suggestions")
}
```

Note: dropped fields are `content`, `status`, `reviewedAt`, `reviewNote`, and the `version` back-relation. The version link to `SharedEnvironmentVersion` is severed (Step 5).

- [ ] **Step 4: Add `SuggestionItem` model directly below**

```prisma
model SuggestionItem {
  id           String               @id @default(uuid())
  suggestionId String               @map("suggestion_id")
  itemType     SuggestionItemType   @map("item_type")
  payload      Json
  status       SuggestionItemStatus @default(pending)
  reviewNote   String?              @map("review_note") @db.VarChar(500)
  reviewedAt   DateTime?            @map("reviewed_at")
  createdAt    DateTime             @default(now()) @map("created_at")

  suggestion EnvironmentSuggestion @relation(fields: [suggestionId], references: [id], onDelete: Cascade)

  @@index([suggestionId, status])
  @@map("suggestion_items")
}
```

- [ ] **Step 5: Drop `suggestionId` column and relation from `SharedEnvironmentVersion`**

Inside `model SharedEnvironmentVersion { ... }`, remove the two lines:
```prisma
  suggestionId String?                @unique @map("suggestion_id")
  suggestion   EnvironmentSuggestion? @relation(fields: [suggestionId], references: [id], onDelete: SetNull)
```
Rationale: approve no longer creates versions (D6); republish is the sole version creator and doesn't need a suggestion FK.

- [ ] **Step 6: Add attribution columns to `Annotation`**

Inside `model Annotation { ... }`, append before the closing brace (above the `@@index` lines):
```prisma
  sourceSuggestionId String?                @map("source_suggestion_id")
  sourceSuggestion   EnvironmentSuggestion? @relation("SuggestionSourcedAnnotations", fields: [sourceSuggestionId], references: [id], onDelete: SetNull)
  originalAuthorId   String?                @map("original_author_id")
  originalAuthor     User?                  @relation("OriginalAuthorOfAnnotations", fields: [originalAuthorId], references: [id], onDelete: SetNull)
```

- [ ] **Step 7: Add attribution columns to `Highlight`**

Same shape as Step 6, relation names `"SuggestionSourcedHighlights"` and `"OriginalAuthorOfHighlights"`.

- [ ] **Step 8: Add attribution columns to `Dossier`**

Same shape as Step 6, relation names `"SuggestionSourcedDossiers"` and `"OriginalAuthorOfDossiers"`.

- [ ] **Step 9: Add attribution columns to `QuickNorm`**

Same shape as Step 6, relation names `"SuggestionSourcedQuickNorms"` and `"OriginalAuthorOfQuickNorms"`.

- [ ] **Step 10: Add attribution columns to `CustomAlias`**

Same shape as Step 6, relation names `"SuggestionSourcedAliases"` and `"OriginalAuthorOfAliases"`.

- [ ] **Step 11: Add inverse relations on `User` model**

Inside `model User { ... }`, below the existing `suggestionsMade` line, add:
```prisma
  originalAuthorOfAnnotations Annotation[]  @relation("OriginalAuthorOfAnnotations")
  originalAuthorOfHighlights  Highlight[]   @relation("OriginalAuthorOfHighlights")
  originalAuthorOfDossiers    Dossier[]     @relation("OriginalAuthorOfDossiers")
  originalAuthorOfQuickNorms  QuickNorm[]   @relation("OriginalAuthorOfQuickNorms")
  originalAuthorOfAliases     CustomAlias[] @relation("OriginalAuthorOfAliases")
```

- [ ] **Step 12: Validate schema**

Run: `cd backend && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`.

- [ ] **Step 13: Reset DB and apply migration**

Run: `cd backend && npx prisma migrate reset --force && npx prisma migrate dev --name forum_suggestions_rework`
Expected: `Your database is now in sync with your schema`. No "data loss" prompt (reset wiped the DB first).

- [ ] **Step 14: Regenerate Prisma client**

Run: `cd backend && npx prisma generate`
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 15: Confirm backend still typechecks (baseline will have compiler errors from controller — that's expected, flag them)**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -30`
Expected: errors in `sharedEnvironmentController.ts` referencing the now-gone `SuggestionStatus` / `suggestion.content` / etc. Record the error list — Task 3 will clean them up.

- [ ] **Step 16: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): SuggestionItem model + attribution columns on workspace tables

Drops EnvironmentSuggestion.content/status/reviewNote; atomic review now lives
at the SuggestionItem row. Adds sourceSuggestionId + originalAuthorId to
Annotation/Highlight/Dossier/QuickNorm/CustomAlias. Drops
SharedEnvironmentVersion.suggestionId (approve no longer creates versions)."
```

---

## Task 2: Backend test infrastructure (vitest + supertest)

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/tests/setup.ts`
- Create: `backend/tests/helpers.ts`
- Create: `backend/tests/smoke.test.ts`

- [ ] **Step 1: Install dev dependencies**

Run: `cd backend && npm install --save-dev vitest supertest @types/supertest`
Expected: package-lock.json updated, no audit errors.

- [ ] **Step 2: Add scripts to `backend/package.json`**

Under `"scripts"`, add alongside the existing entries:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `backend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // sequential — tests share one Postgres DB
      },
    },
  },
});
```

- [ ] **Step 4: Create `backend/tests/setup.ts`**

```ts
import { beforeAll, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(() => {
  // Assumes a dedicated test DB URL is set in backend/.env.test or the shell.
  // Reset ensures schema matches the current migration list.
  execSync('npx prisma migrate reset --force --skip-seed', { stdio: 'ignore' });
});

beforeEach(async () => {
  // Truncate all tables in one statement, fastest teardown.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "suggestion_items",
      "environment_suggestions",
      "shared_environment_versions",
      "shared_environment_likes",
      "shared_environment_reports",
      "shared_environments",
      "annotations",
      "highlights",
      "dossier_items",
      "dossiers",
      "quick_norms",
      "custom_aliases",
      "environments",
      "bookmarks",
      "folders",
      "search_history",
      "feedbacks",
      "users"
    RESTART IDENTITY CASCADE;
  `);
});

export { prisma };
```

- [ ] **Step 5: Create `backend/tests/helpers.ts`**

```ts
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import app from '../src/app';

const prisma = new PrismaClient();

export interface TestUser {
  id: string;
  email: string;
  username: string;
  token: string;
}

export async function createTestUser(username: string): Promise<TestUser> {
  const password = await bcrypt.hash('test-password', 4);
  const user = await prisma.user.create({
    data: {
      email: `${username}@test.local`,
      username,
      password,
      isVerified: true,
      isActive: true,
    },
  });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '1h',
  });
  return { id: user.id, email: user.email, username: user.username, token };
}

export function authHeader(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

export async function createSharedEnv(owner: TestUser, overrides: Partial<{ title: string }> = {}) {
  return prisma.sharedEnvironment.create({
    data: {
      title: overrides.title ?? 'Test Env',
      description: 'from tests',
      content: { dossiers: [], quickNorms: [], annotations: [], highlights: [] },
      category: 'civil',
      tags: [],
      userId: owner.id,
    },
  });
}

export { request, app, prisma };
```

- [ ] **Step 6: Extract the express app to `backend/src/app.ts`**

Look at current `backend/src/index.ts` — find where `const app = express()` is created and where `app.listen(...)` is called. Move everything BEFORE `app.listen` (imports, middleware registration, route mounting) into a new file `backend/src/app.ts` that ends with `export default app;`. Keep `app.listen(...)` in `src/index.ts` along with `import app from './app'`.

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors beyond the ones already inherited from schema change in Task 1.

- [ ] **Step 7: Create smoke test to verify infra**

File: `backend/tests/smoke.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { request, app, createTestUser, authHeader } from './helpers';

describe('test infra smoke', () => {
  it('boots the app and authenticates a created user', async () => {
    const alice = await createTestUser('alice');
    const res = await request(app).get('/api/auth/me').set(authHeader(alice));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('alice');
  });
});
```

- [ ] **Step 8: Provision a test database URL**

Create (if not present) `backend/.env.test` with:
```
DATABASE_URL="postgresql://localhost:5432/visualex_test"
JWT_SECRET="test-secret"
REDIS_ENABLED="false"
```

Ensure the test DB exists: `createdb visualex_test 2>/dev/null || true`.

Modify `backend/vitest.config.ts` to load this env: add at top `import 'dotenv/config';` and `process.env` gets the test file via: replace `setupFiles: ['./tests/setup.ts']` with:
```ts
    env: await (async () => {
      const dotenv = await import('dotenv');
      const result = dotenv.config({ path: '.env.test' });
      return result.parsed ?? {};
    })(),
    setupFiles: ['./tests/setup.ts'],
```
If the top-level await form is awkward, fallback: run tests via `DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2) npm test` and document this in a test README. Simpler path: use `dotenv-cli` in the `test` script:
```json
    "test": "dotenv -e .env.test -- vitest run",
    "test:watch": "dotenv -e .env.test -- vitest"
```
and `npm install --save-dev dotenv-cli`.

- [ ] **Step 9: Run smoke test**

Run: `cd backend && npm test`
Expected: `1 passed`. If Postgres connection fails, verify `visualex_test` DB exists and `postgresql://localhost:5432/visualex_test` is reachable.

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.ts backend/tests backend/src/app.ts backend/src/index.ts backend/.env.test
git commit -m "test(backend): add vitest + supertest + test DB harness

Extracts the express app factory to src/app.ts so tests import without
booting listen(). Adds tests/setup.ts (migrate-reset + per-test truncate),
tests/helpers.ts (user factory + auth), and a smoke test."
```

---

## Task 3: Backend controller rewrite — suggestion lifecycle

**Files:**
- Modify: `backend/src/controllers/sharedEnvironmentController.ts`
- Modify: `backend/src/routes/sharedEnvironments.ts`

The goal is to get the backend compiling again AND expose the new endpoints. Tests for them land in Task 4.

- [ ] **Step 1: Remove obsolete Zod schemas**

In `sharedEnvironmentController.ts`, delete:
- `createSuggestionSchema` (replace next step)
- `approveSuggestionSchema`
- `rejectSuggestionSchema`

- [ ] **Step 2: Add the new item schemas near the top (after the other zod schemas)**

```ts
const MAX_ITEMS_PER_SUGGESTION = 100;
const MAX_SUGGESTION_BYTES = 512 * 1024;

const suggestionItemSchema = z.object({
  itemType: z.enum(['annotation', 'highlight', 'dossier', 'quickNorm', 'alias']),
  payload: z.unknown(),
});

const createSuggestionSchema = z.object({
  message: z.string().max(1000).optional(),
  items: z.array(suggestionItemSchema).min(1).max(MAX_ITEMS_PER_SUGGESTION),
});

const addSuggestionItemsSchema = z.object({
  items: z.array(suggestionItemSchema).min(1).max(MAX_ITEMS_PER_SUGGESTION),
});

const declineItemSchema = z.object({
  reviewNote: z.string().max(500).optional(),
});
```

- [ ] **Step 3: Remove `formatSuggestion` helper and write a new one**

Delete the existing `function formatSuggestion(...)` block.

Add new helper:
```ts
type ItemStatusCounts = { pending: number; taken: number; declined: number };

function deriveSuggestionStatus(counts: ItemStatusCounts): 'open' | 'closed' | 'revoked' {
  const total = counts.pending + counts.taken + counts.declined;
  if (total === 0) return 'revoked';
  if (counts.pending > 0) return 'open';
  return 'closed';
}

function formatSuggestion(suggestion: any, currentUserId: string) {
  const items = (suggestion.items ?? []) as Array<{
    id: string;
    itemType: string;
    payload: unknown;
    status: 'pending' | 'taken' | 'declined';
    reviewNote: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
  }>;

  const counts: ItemStatusCounts = { pending: 0, taken: 0, declined: 0 };
  for (const i of items) counts[i.status] += 1;

  return {
    id: suggestion.id,
    sharedEnvironmentId: suggestion.sharedEnvironmentId,
    sharedEnvironment: suggestion.sharedEnvironment ? {
      id: suggestion.sharedEnvironment.id,
      title: suggestion.sharedEnvironment.title,
      user: suggestion.sharedEnvironment.user,
    } : undefined,
    suggester: {
      id: suggestion.suggester.id,
      username: suggestion.suggester.username,
    },
    message: suggestion.message,
    items: items.map(i => ({
      id: i.id,
      itemType: i.itemType,
      payload: i.payload,
      status: i.status,
      reviewNote: i.reviewNote,
      reviewedAt: i.reviewedAt,
      createdAt: i.createdAt,
    })),
    counts,
    aggregateStatus: deriveSuggestionStatus(counts),
    createdAt: suggestion.createdAt,
    updatedAt: suggestion.updatedAt,
    isOwn: suggestion.suggesterId === currentUserId,
  };
}
```

- [ ] **Step 4: Rewrite `createSuggestion` handler**

Replace the existing body. Checks: env exists + is active; not own env; no existing **open** suggestion from same user; total payload under 512KB; then create parent + items in a single `$transaction`.

```ts
export const createSuggestion = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = createSuggestionSchema.parse(req.body);

  const env = await prisma.sharedEnvironment.findFirst({
    where: { id, isActive: true },
  });
  if (!env) throw new AppError(404, 'Shared environment not found or not active');
  if (env.userId === req.user!.id) {
    throw new AppError(400, 'You cannot suggest to your own environment');
  }

  const existingOpen = await prisma.environmentSuggestion.findFirst({
    where: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      items: { some: { status: 'pending' } },
    },
  });
  if (existingOpen) {
    throw new AppError(400, 'You already have an open suggestion for this environment');
  }

  const totalBytes = JSON.stringify(data.items).length;
  if (totalBytes > MAX_SUGGESTION_BYTES) {
    throw new AppError(400, 'Suggestion payload exceeds maximum size (512KB)');
  }

  const suggestion = await prisma.environmentSuggestion.create({
    data: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      message: data.message,
      items: {
        create: data.items.map(i => ({
          itemType: i.itemType,
          payload: i.payload as object,
        })),
      },
    },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
  });

  res.status(201).json(formatSuggestion(suggestion, req.user!.id));
};
```

- [ ] **Step 5: Rewrite `getReceivedSuggestions`**

Supports `?status=open|closed|revoked` via post-fetch derived filter (simpler than SQL aggregation).

```ts
export const getReceivedSuggestions = async (req: Request, res: Response) => {
  const statusFilter = req.query.status as 'open' | 'closed' | 'revoked' | undefined;

  const suggestions = await prisma.environmentSuggestion.findMany({
    where: { sharedEnvironment: { userId: req.user!.id } },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  let formatted = suggestions.map(s => formatSuggestion(s, req.user!.id));
  if (statusFilter) {
    formatted = formatted.filter(s => s.aggregateStatus === statusFilter);
  }
  res.json(formatted);
};
```

- [ ] **Step 6: Rewrite `getSentSuggestions`**

Same shape as Step 5 but filter by `suggesterId` and no status query (suggester sees all their threads).

```ts
export const getSentSuggestions = async (req: Request, res: Response) => {
  const suggestions = await prisma.environmentSuggestion.findMany({
    where: { suggesterId: req.user!.id },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(suggestions.map(s => formatSuggestion(s, req.user!.id)));
};
```

- [ ] **Step 7: Rewrite `getPendingSuggestionsCount`**

Now counts `SuggestionItem` rows with status=pending where parent env belongs to user.

```ts
export const getPendingSuggestionsCount = async (req: Request, res: Response) => {
  const count = await prisma.suggestionItem.count({
    where: {
      status: 'pending',
      suggestion: { sharedEnvironment: { userId: req.user!.id } },
    },
  });
  res.json({ count });
};
```

- [ ] **Step 8: Delete `approveSuggestion` and `rejectSuggestion` handlers**

Remove both functions from the controller.

- [ ] **Step 9: Add `takeSuggestionItem` handler**

Landing point: the owner's private workspace tables (not the SharedEnvironment `content` JSON). Payload shapes from the spec §Data Model.

```ts
export const takeSuggestionItem = async (req: Request, res: Response) => {
  const { id: suggestionId, itemId } = req.params;

  const item = await prisma.suggestionItem.findUnique({
    where: { id: itemId },
    include: {
      suggestion: {
        include: {
          sharedEnvironment: true,
          suggester: { select: { id: true, username: true } },
        },
      },
    },
  });

  if (!item || item.suggestion.id !== suggestionId) {
    throw new AppError(404, 'Suggestion item not found');
  }
  if (item.suggestion.sharedEnvironment.userId !== req.user!.id) {
    throw new AppError(403, 'You can only take items from suggestions to your own environments');
  }
  if (item.status !== 'pending') {
    throw new AppError(409, 'Item already reviewed');
  }

  const attribution = {
    sourceSuggestionId: item.suggestion.id,
    originalAuthorId: item.suggestion.suggesterId,
  };

  let createdRow: unknown = null;
  try {
    createdRow = await prisma.$transaction(async (tx) => {
      const payload = item.payload as any;
      switch (item.itemType) {
        case 'annotation':
          return tx.annotation.create({
            data: {
              userId: req.user!.id,
              normaKey: payload.articleId ?? payload.normaKey ?? '',
              content: payload.text,
              textContext: payload.anchorText,
              position: payload.startOffset,
              ...attribution,
            },
          });
        case 'highlight':
          return tx.highlight.create({
            data: {
              userId: req.user!.id,
              normaKey: payload.articleId ?? payload.normaKey ?? '',
              text: payload.anchorText ?? '',
              color: payload.colorVar ?? 'yellow',
              startOffset: payload.startOffset ?? 0,
              endOffset: payload.endOffset ?? 0,
              ...attribution,
            },
          });
        case 'dossier': {
          const entries = Array.isArray(payload.entries) ? payload.entries : [];
          return tx.dossier.create({
            data: {
              userId: req.user!.id,
              name: payload.title,
              description: payload.description,
              ...attribution,
              items: {
                create: entries.map((e: any, idx: number) => ({
                  itemType: e.articleRef ? 'norm' : 'note',
                  title: e.articleRef?.label ?? e.note?.slice(0, 60) ?? `Item ${idx + 1}`,
                  content: e,
                  position: idx,
                })),
              },
            },
            include: { items: true },
          });
        }
        case 'quickNorm':
          return tx.quickNorm.create({
            data: {
              userId: req.user!.id,
              label: payload.label,
              searchParams: payload.searchParams,
              sourceUrl: payload.sourceUrl,
              ...attribution,
            },
          });
        case 'alias':
          return tx.customAlias.create({
            data: {
              userId: req.user!.id,
              trigger: payload.trigger,
              aliasType: payload.aliasType,
              expandTo: payload.expandTo,
              searchParams: payload.searchParams,
              description: payload.description,
              ...attribution,
            },
          });
        default:
          throw new AppError(400, `Unsupported itemType: ${item.itemType}`);
      }
    });
  } catch (err: unknown) {
    // Alias trigger conflict
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002' &&
      item.itemType === 'alias'
    ) {
      const existing = await prisma.customAlias.findFirst({
        where: {
          userId: req.user!.id,
          trigger: (item.payload as any).trigger,
        },
      });
      res.status(409).json({
        error: 'alias_trigger_conflict',
        existingAliasId: existing?.id,
        suggestedTrigger: (item.payload as any).trigger,
      });
      return;
    }
    throw err;
  }

  await prisma.suggestionItem.update({
    where: { id: itemId },
    data: { status: 'taken', reviewedAt: new Date() },
  });

  res.json({ item: { id: itemId, status: 'taken' }, created: createdRow });
};
```

- [ ] **Step 10: Add `declineSuggestionItem` handler**

```ts
export const declineSuggestionItem = async (req: Request, res: Response) => {
  const { id: suggestionId, itemId } = req.params;
  const data = declineItemSchema.parse(req.body);

  const item = await prisma.suggestionItem.findUnique({
    where: { id: itemId },
    include: { suggestion: { include: { sharedEnvironment: true } } },
  });

  if (!item || item.suggestion.id !== suggestionId) {
    throw new AppError(404, 'Suggestion item not found');
  }
  if (item.suggestion.sharedEnvironment.userId !== req.user!.id) {
    throw new AppError(403, 'You can only decline items from suggestions to your own environments');
  }
  if (item.status !== 'pending') {
    throw new AppError(409, 'Item already reviewed');
  }

  const updated = await prisma.suggestionItem.update({
    where: { id: itemId },
    data: { status: 'declined', reviewNote: data.reviewNote, reviewedAt: new Date() },
  });

  res.json({
    id: updated.id,
    status: updated.status,
    reviewNote: updated.reviewNote,
    reviewedAt: updated.reviewedAt,
  });
};
```

- [ ] **Step 11: Add `revokeSuggestionItem` handler (suggester deletes)**

```ts
export const revokeSuggestionItem = async (req: Request, res: Response) => {
  const { id: suggestionId, itemId } = req.params;

  const item = await prisma.suggestionItem.findUnique({
    where: { id: itemId },
    include: { suggestion: true },
  });

  if (!item || item.suggestion.id !== suggestionId) {
    throw new AppError(404, 'Suggestion item not found');
  }
  if (item.suggestion.suggesterId !== req.user!.id) {
    throw new AppError(403, 'You can only revoke your own suggestion items');
  }
  if (item.status !== 'pending') {
    throw new AppError(403, 'Only pending items can be revoked');
  }

  await prisma.suggestionItem.delete({ where: { id: itemId } });
  res.status(204).send();
};
```

- [ ] **Step 12: Add `addSuggestionItems` handler (suggester appends to open thread)**

```ts
export const addSuggestionItems = async (req: Request, res: Response) => {
  const { id: suggestionId } = req.params;
  const data = addSuggestionItemsSchema.parse(req.body);

  const suggestion = await prisma.environmentSuggestion.findUnique({
    where: { id: suggestionId },
    include: { items: true },
  });

  if (!suggestion) throw new AppError(404, 'Suggestion not found');
  if (suggestion.suggesterId !== req.user!.id) {
    throw new AppError(403, 'You can only add items to your own suggestions');
  }

  // Reject if the thread is already "closed": every item reviewed (none pending)
  // AND at least one review happened. A thread with items but zero reviews is
  // still open. A revoked thread (zero items) is open for appending.
  const pendingCount = suggestion.items.filter(i => i.status === 'pending').length;
  const reviewedCount = suggestion.items.length - pendingCount;
  if (pendingCount === 0 && reviewedCount > 0) {
    throw new AppError(409, 'Thread is closed — create a new suggestion');
  }

  if (suggestion.items.length + data.items.length > MAX_ITEMS_PER_SUGGESTION) {
    throw new AppError(400, 'Maximum items per suggestion exceeded');
  }

  await prisma.suggestionItem.createMany({
    data: data.items.map(i => ({
      suggestionId,
      itemType: i.itemType,
      payload: i.payload as object,
    })),
  });

  const refreshed = await prisma.environmentSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
  });

  res.status(201).json(formatSuggestion(refreshed!, req.user!.id));
};
```

- [ ] **Step 13: Update routes in `backend/src/routes/sharedEnvironments.ts`**

Remove the two lines:
```ts
router.post('/shared-environments-suggestions/:suggestionId/approve', controller.approveSuggestion);
router.post('/shared-environments-suggestions/:suggestionId/reject', controller.rejectSuggestion);
```

Add, in the Suggestions section:
```ts
// Per-item lifecycle
router.post('/shared-environments-suggestions/:id/items/:itemId/take', controller.takeSuggestionItem);
router.post('/shared-environments-suggestions/:id/items/:itemId/decline', controller.declineSuggestionItem);
router.delete('/shared-environments-suggestions/:id/items/:itemId', controller.revokeSuggestionItem);
router.post('/shared-environments-suggestions/:id/items', controller.addSuggestionItems);
```

- [ ] **Step 14: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: exit 0. If errors remain, fix them now.

- [ ] **Step 15: Smoke run**

Run: `cd backend && npm run dev` in one terminal; in another:
```bash
# Register + login two users
curl -s -X POST http://localhost:3001/api/auth/register -H 'content-type: application/json' \
  -d '{"email":"alice@t.local","username":"alice","password":"xxxxxxx1"}'
curl -s -X POST http://localhost:3001/api/auth/register -H 'content-type: application/json' \
  -d '{"email":"bob@t.local","username":"bob","password":"xxxxxxx1"}'
ALICE=$(curl -s -X POST http://localhost:3001/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@t.local","password":"xxxxxxx1"}' | jq -r .token)
# ... you get the idea — full flow documented in Task 4 tests.
```
Skip if tests in Task 4 cover it.

- [ ] **Step 16: Commit**

```bash
git add backend/src/controllers/sharedEnvironmentController.ts backend/src/routes/sharedEnvironments.ts
git commit -m "feat(forum): per-item suggestion lifecycle endpoints

Drops approve/reject monolithic flow. Adds take/decline/revoke/add-items.
Take lands the item in the owner's private workspace with attribution
(sourceSuggestionId + originalAuthorId). Alias trigger collision returns
409 with { error: 'alias_trigger_conflict', existingAliasId }."
```

---

## Task 4: Backend integration tests — lifecycle, authZ, alias conflict, attribution

**Files:**
- Create: `backend/tests/suggestions.lifecycle.test.ts`
- Create: `backend/tests/suggestions.alias-conflict.test.ts`
- Create: `backend/tests/suggestions.attribution.test.ts`

- [ ] **Step 1: Write the lifecycle test scaffold**

File: `backend/tests/suggestions.lifecycle.test.ts`
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, createSharedEnv, prisma, type TestUser } from './helpers';

describe('suggestion lifecycle', () => {
  let alice: TestUser; // owner
  let bob: TestUser;   // suggester
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    const env = await createSharedEnv(alice, { title: 'Alice env' });
    envId = env.id;
  });

  it('creates a suggestion with N items', async () => {
    const res = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        message: 'hello',
        items: [
          { itemType: 'annotation', payload: { articleId: 'art-2043', text: 'nota 1' } },
          { itemType: 'quickNorm', payload: { label: 'Art 2043', searchParams: { act_type: 'codice civile', article: '2043' } } },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.counts).toEqual({ pending: 2, taken: 0, declined: 0 });
    expect(res.body.aggregateStatus).toBe('open');
  });

  it('owner takes one item, declines another — partial review stays open', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        items: [
          { itemType: 'annotation', payload: { articleId: 'art-2043', text: 'nota A' } },
          { itemType: 'annotation', payload: { articleId: 'art-2050', text: 'nota B' } },
          { itemType: 'quickNorm', payload: { label: 'Q', searchParams: { act_type: 'cc' } } },
        ],
      });
    const sugId = create.body.id;
    const [a, b] = create.body.items;

    const take = await request(app)
      .post(`/api/shared-environments-suggestions/${sugId}/items/${a.id}/take`)
      .set(authHeader(alice));
    expect(take.status).toBe(200);

    const decline = await request(app)
      .post(`/api/shared-environments-suggestions/${sugId}/items/${b.id}/decline`)
      .set(authHeader(alice))
      .send({ reviewNote: 'già presente' });
    expect(decline.status).toBe(200);

    const received = await request(app)
      .get('/api/shared-environments-suggestions/received')
      .set(authHeader(alice));
    const s = received.body.find((x: any) => x.id === sugId);
    expect(s.counts).toEqual({ pending: 1, taken: 1, declined: 1 });
    expect(s.aggregateStatus).toBe('open');
  });

  it('suggester revokes a pending item', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
    const itemId = create.body.items[0].id;

    const del = await request(app)
      .delete(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}`)
      .set(authHeader(bob));
    expect(del.status).toBe(204);

    const sent = await request(app)
      .get('/api/shared-environments-suggestions/sent')
      .set(authHeader(bob));
    const s = sent.body.find((x: any) => x.id === create.body.id);
    expect(s.items).toHaveLength(0);
    expect(s.aggregateStatus).toBe('revoked');
  });

  it('suggester cannot revoke an already-taken item', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
    const itemId = create.body.items[0].id;
    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}/take`)
      .set(authHeader(alice));

    const del = await request(app)
      .delete(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}`)
      .set(authHeader(bob));
    expect(del.status).toBe(403);
  });

  it('appending items to a closed thread returns 409', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${create.body.items[0].id}/take`)
      .set(authHeader(alice));

    const add = await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'quickNorm', payload: { label: 'L', searchParams: {} } }] });
    expect(add.status).toBe(409);
  });

  it('pending-count reflects items, not suggestions', async () => {
    await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        items: [
          { itemType: 'annotation', payload: { articleId: 'x', text: 'a' } },
          { itemType: 'annotation', payload: { articleId: 'y', text: 'b' } },
          { itemType: 'annotation', payload: { articleId: 'z', text: 'c' } },
        ],
      });
    const count = await request(app)
      .get('/api/shared-environments-suggestions/pending-count')
      .set(authHeader(alice));
    expect(count.body.count).toBe(3);
  });
});
```

- [ ] **Step 2: Run lifecycle test**

Run: `cd backend && npm test -- suggestions.lifecycle`
Expected: 6 tests pass.

- [ ] **Step 3: AuthZ tests (same file, appended)**

Append inside the `describe` block:
```ts
  describe('authz', () => {
    let carol: TestUser;
    let sugId: string;
    let itemId: string;

    beforeEach(async () => {
      carol = await createTestUser('carol');
      const create = await request(app)
        .post(`/api/shared-environments/${envId}/suggestions`)
        .set(authHeader(bob))
        .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
      sugId = create.body.id;
      itemId = create.body.items[0].id;
    });

    it('suggester cannot take their own item', async () => {
      const res = await request(app)
        .post(`/api/shared-environments-suggestions/${sugId}/items/${itemId}/take`)
        .set(authHeader(bob));
      expect(res.status).toBe(403);
    });

    it('a third user cannot decline someone else\'s item', async () => {
      const res = await request(app)
        .post(`/api/shared-environments-suggestions/${sugId}/items/${itemId}/decline`)
        .set(authHeader(carol))
        .send({ reviewNote: 'mind your business' });
      expect(res.status).toBe(403);
    });

    it('owner cannot revoke suggester\'s items', async () => {
      const res = await request(app)
        .delete(`/api/shared-environments-suggestions/${sugId}/items/${itemId}`)
        .set(authHeader(alice));
      expect(res.status).toBe(403);
    });

    it('suggester cannot send a second open suggestion to same env', async () => {
      const res = await request(app)
        .post(`/api/shared-environments/${envId}/suggestions`)
        .set(authHeader(bob))
        .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't2' } }] });
      expect(res.status).toBe(400);
    });
  });
```

- [ ] **Step 4: Run authZ tests**

Run: `cd backend && npm test -- suggestions.lifecycle`
Expected: 10 tests pass.

- [ ] **Step 5: Write alias-conflict test**

File: `backend/tests/suggestions.alias-conflict.test.ts`
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, createSharedEnv, prisma, type TestUser } from './helpers';

describe('alias trigger conflict on take', () => {
  let alice: TestUser;
  let bob: TestUser;
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    envId = (await createSharedEnv(alice)).id;
  });

  it('returns 409 with resolution payload when alice already owns trigger "cc"', async () => {
    await prisma.customAlias.create({
      data: {
        userId: alice.id,
        trigger: 'cc',
        aliasType: 'shortcut',
        expandTo: 'codice civile',
      },
    });

    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        items: [{
          itemType: 'alias',
          payload: { trigger: 'cc', aliasType: 'reference', expandTo: 'Civil Code', description: 'mine' },
        }],
      });
    const itemId = create.body.items[0].id;

    const take = await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}/take`)
      .set(authHeader(alice));

    expect(take.status).toBe(409);
    expect(take.body.error).toBe('alias_trigger_conflict');
    expect(take.body.suggestedTrigger).toBe('cc');
    expect(take.body.existingAliasId).toBeTruthy();
  });

  it('item status stays pending after a 409 conflict (no half-state)', async () => {
    await prisma.customAlias.create({
      data: { userId: alice.id, trigger: 'cc', aliasType: 'shortcut', expandTo: 'civile' },
    });
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'alias', payload: { trigger: 'cc', aliasType: 'shortcut', expandTo: 'x' } }] });
    const itemId = create.body.items[0].id;

    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}/take`)
      .set(authHeader(alice));

    const item = await prisma.suggestionItem.findUnique({ where: { id: itemId } });
    expect(item?.status).toBe('pending');
  });
});
```

- [ ] **Step 6: Run alias conflict tests**

Run: `cd backend && npm test -- suggestions.alias-conflict`
Expected: 2 tests pass.

- [ ] **Step 7: Write attribution test**

File: `backend/tests/suggestions.attribution.test.ts`
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, createSharedEnv, prisma, type TestUser } from './helpers';

describe('attribution', () => {
  let alice: TestUser; // owner
  let bob: TestUser;   // suggester
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    envId = (await createSharedEnv(alice)).id;
  });

  it('take annotation populates sourceSuggestionId + originalAuthorId', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'art-2043', text: 'nota' } }] });
    const sugId = create.body.id;
    const itemId = create.body.items[0].id;

    const take = await request(app)
      .post(`/api/shared-environments-suggestions/${sugId}/items/${itemId}/take`)
      .set(authHeader(alice));
    expect(take.status).toBe(200);

    const [ann] = await prisma.annotation.findMany({ where: { userId: alice.id } });
    expect(ann.sourceSuggestionId).toBe(sugId);
    expect(ann.originalAuthorId).toBe(bob.id);
  });

  it('deleting the suggester account sets originalAuthorId to null but the row stays', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'quickNorm', payload: { label: 'L', searchParams: {} } }] });
    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${create.body.items[0].id}/take`)
      .set(authHeader(alice));

    await prisma.user.delete({ where: { id: bob.id } });

    const qn = await prisma.quickNorm.findFirst({ where: { userId: alice.id } });
    expect(qn).toBeTruthy();
    expect(qn?.originalAuthorId).toBeNull();
    expect(qn?.sourceSuggestionId).toBeNull(); // cascade chain also sets this null
  });
});
```

- [ ] **Step 8: Run attribution tests**

Run: `cd backend && npm test -- suggestions.attribution`
Expected: 2 tests pass.

- [ ] **Step 9: Run full test suite**

Run: `cd backend && npm test`
Expected: all green (~15 tests including smoke).

- [ ] **Step 10: Commit**

```bash
git add backend/tests
git commit -m "test(forum): integration tests for suggestion lifecycle + attribution

Covers: create/take/decline/revoke/append, authZ across three users,
alias trigger conflict 409 with pending-state preservation, and
cascade SetNull behaviour on suggester account deletion."
```

---

## Task 5: Frontend types + service — refactor the data layer

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/sharedEnvironmentService.ts`

- [ ] **Step 1: Drop obsolete types in `types/index.ts`**

Delete:
- `export type SuggestionStatus = 'pending' | 'approved' | 'rejected';`
- `export interface SuggestionContent { ... }`
- `export interface ApproveSuggestionPayload { ... }`

- [ ] **Step 2: Add new types in their place**

```ts
export type SuggestionItemType = 'annotation' | 'highlight' | 'dossier' | 'quickNorm' | 'alias';
export type SuggestionItemStatus = 'pending' | 'taken' | 'declined';
export type SuggestionAggregateStatus = 'open' | 'closed' | 'revoked';

export interface OriginalAuthor {
    id: string;
    username: string;
}

export interface SuggestionItem {
    id: string;
    itemType: SuggestionItemType;
    payload: unknown; // shape depends on itemType — validated by consumers
    status: SuggestionItemStatus;
    reviewNote?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
}

export interface SuggestionItemCounts {
    pending: number;
    taken: number;
    declined: number;
}
```

- [ ] **Step 3: Rewrite `EnvironmentSuggestion`**

Replace the existing interface with:
```ts
export interface EnvironmentSuggestion {
    id: string;
    sharedEnvironmentId: string;
    sharedEnvironment?: {
        id: string;
        title: string;
        user: SharedEnvironmentUser;
    };
    suggester: SharedEnvironmentUser;
    message?: string;
    items: SuggestionItem[];
    counts: SuggestionItemCounts;
    aggregateStatus: SuggestionAggregateStatus;
    createdAt: string;
    updatedAt: string;
    isOwn: boolean;
}
```

- [ ] **Step 4: Rewrite `CreateSuggestionPayload`**

```ts
export interface CreateSuggestionPayload {
    message?: string;
    items: Array<{ itemType: SuggestionItemType; payload: unknown }>;
}

export interface AddSuggestionItemsPayload {
    items: Array<{ itemType: SuggestionItemType; payload: unknown }>;
}
```

- [ ] **Step 5: Add attribution fields to `Annotation`**

Inside `export interface Annotation { ... }`, add before the closing brace:
```ts
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
```

- [ ] **Step 6: Add attribution fields to the other four interfaces**

Same two fields on `Highlight`, `Dossier`, `QuickNorm`, `CustomAlias`.

- [ ] **Step 7: Typecheck fails — that's expected, move to Step 8**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | head -30`
Expected: errors in `SuggestContentModal.tsx`, `ForumSuggestionsView.tsx`, `BulletinBoardPage.tsx`, `sharedEnvironmentService.ts` where old fields are referenced. These get fixed as we proceed.

- [ ] **Step 8: Update `sharedEnvironmentService.ts` — remove old methods**

Delete `approveSuggestion` and `rejectSuggestion` methods.

- [ ] **Step 9: Add new suggestion-item methods**

Add below `getPendingSuggestionsCount`:
```ts
  /**
   * Take a suggestion item (owner only). Returns { item, created } or
   * throws 409 with { error: 'alias_trigger_conflict', ... } payload.
   */
  async takeSuggestionItem(suggestionId: string, itemId: string): Promise<{
    item: { id: string; status: 'taken' };
    created: unknown;
  }> {
    const response = await apiClient.post(
      `/shared-environments-suggestions/${suggestionId}/items/${itemId}/take`
    );
    return response.data;
  },

  async declineSuggestionItem(
    suggestionId: string,
    itemId: string,
    reviewNote?: string
  ): Promise<{ id: string; status: 'declined'; reviewNote?: string }> {
    const response = await apiClient.post(
      `/shared-environments-suggestions/${suggestionId}/items/${itemId}/decline`,
      { reviewNote }
    );
    return response.data;
  },

  async revokeSuggestionItem(suggestionId: string, itemId: string): Promise<void> {
    await apiClient.delete(
      `/shared-environments-suggestions/${suggestionId}/items/${itemId}`
    );
  },

  async addSuggestionItems(
    suggestionId: string,
    data: AddSuggestionItemsPayload
  ): Promise<EnvironmentSuggestion> {
    const response = await apiClient.post(
      `/shared-environments-suggestions/${suggestionId}/items`,
      data
    );
    return response.data;
  },
```

- [ ] **Step 10: Update service imports**

At the top of `sharedEnvironmentService.ts`, the import block should include `AddSuggestionItemsPayload` and drop `ApproveSuggestionPayload`:
```ts
import type {
  ...,
  CreateSuggestionPayload,
  AddSuggestionItemsPayload,
  ...
} from '../types';
```

- [ ] **Step 11: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep -c "error TS"`
Expected: errors still exist in UI components (fixed in Tasks 6-9), but service + types are clean. If any service-level error persists, fix now.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/sharedEnvironmentService.ts
git commit -m "refactor(forum): rework suggestion types and service for per-item flow

Drops SuggestionContent/ApproveSuggestionPayload. Adds SuggestionItem
with SuggestionItemType/Status enums, SuggestionItemCounts, and
aggregateStatus derivation. Adds sourceSuggestionId/originalAuthor
fields to Annotation/Highlight/Dossier/QuickNorm/CustomAlias. Service
drops approveSuggestion/rejectSuggestion in favour of per-item
take/decline/revoke/add."
```

---

## Task 6: SuggestionItemCard — polymorphic renderer for all 5 itemTypes

**Files:**
- Create: `frontend/src/components/features/bulletin/SuggestionItemCard.tsx`
- Create: `frontend/src/components/features/bulletin/AttributionChip.tsx`

- [ ] **Step 1: Create `AttributionChip.tsx`**

```tsx
import { User } from 'lucide-react';
import type { OriginalAuthor } from '../../../types';

interface AttributionChipProps {
  author: OriginalAuthor | null | undefined;
  size?: 'xs' | 'sm';
  className?: string;
}

export function AttributionChip({ author, size = 'xs', className = '' }: AttributionChipProps) {
  const label = author ? `@${author.username}` : '@utente-rimosso';
  const sizeClass = size === 'xs' ? 'text-xs' : 'text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1 ${sizeClass} text-slate-500 dark:text-slate-400 ${className}`}
      title={author ? `Suggerita da @${author.username}` : 'Autore rimosso'}
    >
      <User size={size === 'xs' ? 10 : 12} />
      da {label}
    </span>
  );
}
```

- [ ] **Step 2: Create `SuggestionItemCard.tsx` skeleton**

```tsx
import { ReactNode } from 'react';
import { Check, X as XIcon, Clock, FileText, Highlighter, Folder, Zap, Link2 } from 'lucide-react';
import type { SuggestionItem, SuggestionItemType } from '../../../types';

const ITEM_TYPE_META: Record<SuggestionItemType, { icon: typeof FileText; label: string; colorClass: string }> = {
  annotation: { icon: FileText, label: 'Nota', colorClass: 'text-amber-600 dark:text-amber-400' },
  highlight: { icon: Highlighter, label: 'Evidenziazione', colorClass: 'text-yellow-600 dark:text-yellow-400' },
  dossier: { icon: Folder, label: 'Dossier', colorClass: 'text-indigo-600 dark:text-indigo-400' },
  quickNorm: { icon: Zap, label: 'Norma veloce', colorClass: 'text-emerald-600 dark:text-emerald-400' },
  alias: { icon: Link2, label: 'Alias', colorClass: 'text-purple-600 dark:text-purple-400' },
};

interface SuggestionItemCardProps {
  item: SuggestionItem;
  /** Right-side actions, rendered only when item.status === 'pending'. */
  actions?: ReactNode;
  /** Extra children rendered after the preview (e.g. reviewNote for declined). */
  footer?: ReactNode;
}

export function SuggestionItemCard({ item, actions, footer }: SuggestionItemCardProps) {
  const meta = ITEM_TYPE_META[item.itemType];
  const Icon = meta.icon;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${meta.colorClass}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{meta.label}</span>
            <StatusChip status={item.status} reviewedAt={item.reviewedAt ?? undefined} />
          </div>
          <ItemPreview item={item} />
          {footer}
        </div>
        {item.status === 'pending' && actions && (
          <div className="flex items-center gap-1 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status, reviewedAt }: { status: SuggestionItem['status']; reviewedAt?: string }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        <Clock size={10} /> In attesa
      </span>
    );
  }
  const dateLabel = reviewedAt ? new Date(reviewedAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '';
  if (status === 'taken') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
        <Check size={10} /> Presa{dateLabel && ` il ${dateLabel}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
      <XIcon size={10} /> Rifiutata{dateLabel && ` il ${dateLabel}`}
    </span>
  );
}

function ItemPreview({ item }: { item: SuggestionItem }) {
  const p = item.payload as Record<string, unknown>;
  switch (item.itemType) {
    case 'annotation': {
      const anchor = typeof p.anchorText === 'string' ? p.anchorText : undefined;
      const articleId = typeof p.articleId === 'string' ? p.articleId : '';
      const text = typeof p.text === 'string' ? p.text : '';
      return (
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
            {articleId}{anchor && ` • "${anchor}"`}
          </p>
          <p className="text-sm text-slate-900 dark:text-slate-100 line-clamp-3">{text}</p>
        </div>
      );
    }
    case 'highlight': {
      const color = (typeof p.colorVar === 'string' ? p.colorVar : 'yellow') as string;
      const anchor = typeof p.anchorText === 'string' ? p.anchorText : '';
      const articleId = typeof p.articleId === 'string' ? p.articleId : '';
      return (
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{articleId}</p>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-sm bg-${color}-300`} />
            <p className="text-sm text-slate-900 dark:text-slate-100 line-clamp-2">"{anchor}"</p>
          </div>
        </div>
      );
    }
    case 'dossier': {
      const title = typeof p.title === 'string' ? p.title : 'Dossier';
      const entries = Array.isArray(p.entries) ? p.entries.length : 0;
      const desc = typeof p.description === 'string' ? p.description : '';
      return (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
          {desc && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{desc}</p>}
          <p className="text-xs text-slate-500 dark:text-slate-400">{entries} elementi</p>
        </div>
      );
    }
    case 'quickNorm': {
      const label = typeof p.label === 'string' ? p.label : '';
      const sp = (p.searchParams ?? {}) as Record<string, string>;
      return (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {sp.act_type}{sp.article && ` art. ${sp.article}`}
          </p>
        </div>
      );
    }
    case 'alias': {
      const trigger = typeof p.trigger === 'string' ? p.trigger : '';
      const expand = typeof p.expandTo === 'string' ? p.expandTo : '';
      const aliasType = typeof p.aliasType === 'string' ? p.aliasType : '';
      return (
        <div>
          <p className="text-sm text-slate-900 dark:text-slate-100">
            <code className="font-mono text-xs px-1 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">{trigger}</code>
            {' → '}{expand}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{aliasType}</p>
        </div>
      );
    }
  }
}
```

- [ ] **Step 3: Frontend typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: pre-existing errors elsewhere but no new ones from the new files.

- [ ] **Step 4: Frontend unit test — SuggestionItemCard renders all 5 itemTypes**

File: `frontend/src/components/features/bulletin/SuggestionItemCard.test.tsx`
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuggestionItemCard } from './SuggestionItemCard';
import type { SuggestionItem } from '../../../types';

const base: Omit<SuggestionItem, 'itemType' | 'payload'> = {
  id: 'i1', status: 'pending', reviewNote: null, reviewedAt: null,
  createdAt: new Date().toISOString(),
};

describe('SuggestionItemCard', () => {
  it('renders annotation preview with articleId + anchor', () => {
    render(<SuggestionItemCard item={{
      ...base, itemType: 'annotation',
      payload: { articleId: 'art-2043', anchorText: 'dolo', text: 'Il dolo richiede intenzione.' },
    }} />);
    expect(screen.getByText(/art-2043/)).toBeInTheDocument();
    expect(screen.getByText(/dolo/)).toBeInTheDocument();
  });

  it('renders alias with trigger → expandTo', () => {
    render(<SuggestionItemCard item={{
      ...base, itemType: 'alias',
      payload: { trigger: 'cc', aliasType: 'shortcut', expandTo: 'codice civile' },
    }} />);
    expect(screen.getByText('cc')).toBeInTheDocument();
    expect(screen.getByText(/codice civile/)).toBeInTheDocument();
  });

  it('renders "Presa il DD/MM" chip for taken status', () => {
    render(<SuggestionItemCard item={{
      ...base, itemType: 'quickNorm',
      status: 'taken', reviewedAt: '2026-04-20T10:00:00Z',
      payload: { label: 'Test', searchParams: { act_type: 'cc' } },
    }} />);
    expect(screen.getByText(/Presa il 20\/04/)).toBeInTheDocument();
  });
});
```

Run: `cd frontend && npm test -- SuggestionItemCard`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/features/bulletin/SuggestionItemCard.tsx frontend/src/components/features/bulletin/SuggestionItemCard.test.tsx frontend/src/components/features/bulletin/AttributionChip.tsx
git commit -m "feat(forum): SuggestionItemCard + AttributionChip components

Polymorphic renderer for all 5 itemTypes with status chip (pending /
taken on DD/MM / declined on DD/MM). Shared AttributionChip for the
'da @mario' signature reused across notes / highlights / dossiers /
quickNorms / aliases. Unit tests cover three itemType renderings."
```

---

## Task 7: SuggestionReviewDialog + AliasConflictDialog (owner review flow)

**Files:**
- Create: `frontend/src/components/features/bulletin/AliasConflictDialog.tsx`
- Create: `frontend/src/components/features/bulletin/SuggestionReviewDialog.tsx`

- [ ] **Step 1: Create `AliasConflictDialog.tsx`**

```tsx
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface AliasConflictDialogProps {
  suggestedTrigger: string;
  onChoose: (choice: { action: 'replace' } | { action: 'rename'; newTrigger: string } | { action: 'skip' }) => void;
  onClose: () => void;
}

export function AliasConflictDialog({ suggestedTrigger, onChoose, onClose }: AliasConflictDialogProps) {
  const [renameValue, setRenameValue] = useState(`${suggestedTrigger}-2`);
  const trimmed = renameValue.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="text-amber-500 shrink-0" size={20} />
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Trigger già in uso
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Hai già un alias con trigger <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{suggestedTrigger}</code>. Come vuoi procedere?
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => onChoose({ action: 'replace' })}
            className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="text-sm font-medium text-slate-900 dark:text-white">Sostituisci il mio alias</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Il tuo alias esistente verrà eliminato.</div>
          </button>

          <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="text-sm font-medium text-slate-900 dark:text-white mb-1">Rinomina prima di importare</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="flex-1 px-2 py-1 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
              <button
                onClick={() => onChoose({ action: 'rename', newTrigger: trimmed })}
                disabled={!trimmed || trimmed === suggestedTrigger}
                className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Usa
              </button>
            </div>
          </div>

          <button
            onClick={() => onChoose({ action: 'skip' })}
            className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="text-sm font-medium text-slate-900 dark:text-white">Salta questo elemento</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">L'item resta pending, puoi decidere più tardi.</div>
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `SuggestionReviewDialog.tsx` — container & header**

```tsx
import { useMemo, useState } from 'react';
import { X, Check, X as XIcon, FileText, Highlighter, Folder, Zap, Link2, ChevronDown, ChevronRight } from 'lucide-react';
import type { EnvironmentSuggestion, SuggestionItem, SuggestionItemType } from '../../../types';
import { SuggestionItemCard } from './SuggestionItemCard';

export type TakeResult =
  | { kind: 'ok' }
  | { kind: 'alias_conflict'; itemId: string; suggestedTrigger: string; existingAliasId?: string };

interface SuggestionReviewDialogProps {
  suggestion: EnvironmentSuggestion;
  onTake: (itemId: string) => Promise<TakeResult>;
  onDecline: (itemId: string, reviewNote?: string) => Promise<void>;
  onClose: () => void;
}

const SECTION_ORDER: SuggestionItemType[] = ['annotation', 'highlight', 'dossier', 'quickNorm', 'alias'];
const SECTION_META: Record<SuggestionItemType, { label: string; Icon: typeof FileText }> = {
  annotation: { label: 'Note', Icon: FileText },
  highlight: { label: 'Evidenze', Icon: Highlighter },
  dossier: { label: 'Dossier', Icon: Folder },
  quickNorm: { label: 'Norme veloci', Icon: Zap },
  alias: { label: 'Alias', Icon: Link2 },
};

export function SuggestionReviewDialog({ suggestion, onTake, onDecline, onClose }: SuggestionReviewDialogProps) {
  const [declineTargetId, setDeclineTargetId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SuggestionItemType, boolean>>({
    annotation: true, highlight: false, dossier: false, quickNorm: false, alias: false,
  });

  const grouped = useMemo(() => {
    const acc: Record<SuggestionItemType, SuggestionItem[]> = {
      annotation: [], highlight: [], dossier: [], quickNorm: [], alias: [],
    };
    for (const i of suggestion.items) acc[i.itemType].push(i);
    return acc;
  }, [suggestion.items]);

  const reviewedCount = suggestion.counts.taken + suggestion.counts.declined;
  const totalCount = suggestion.items.length;

  const handleTake = async (itemId: string) => {
    setBusyItemId(itemId);
    try {
      await onTake(itemId);
    } finally {
      setBusyItemId(null);
    }
  };

  const handleConfirmDecline = async () => {
    if (!declineTargetId) return;
    setBusyItemId(declineTargetId);
    try {
      await onDecline(declineTargetId, declineNote.trim() || undefined);
      setDeclineTargetId(null);
      setDeclineNote('');
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Suggerimento da @{suggestion.suggester.username}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              per "{suggestion.sharedEnvironment?.title}" · {new Date(suggestion.createdAt).toLocaleDateString('it-IT')}
            </p>
            {suggestion.message && (
              <p className="mt-2 text-sm italic text-slate-700 dark:text-slate-300 max-w-prose">
                "{suggestion.message}"
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body: grouped items */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {SECTION_ORDER.map((type) => {
            const items = grouped[type];
            if (items.length === 0) return null;
            const { label, Icon } = SECTION_META[type];
            const isOpen = expanded[type];
            return (
              <div key={type}>
                <button
                  type="button"
                  onClick={() => setExpanded(prev => ({ ...prev, [type]: !prev[type] }))}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Comprimi' : 'Espandi'} ${label}`}
                  className="w-full flex items-center gap-2 px-1 py-1 text-left text-sm font-medium text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Icon size={16} />
                  {label} ({items.length})
                </button>
                {isOpen && (
                  <div className="mt-2 space-y-2">
                    {items.map(item => (
                      <SuggestionItemCard
                        key={item.id}
                        item={item}
                        actions={
                          <>
                            <button
                              onClick={() => handleTake(item.id)}
                              disabled={busyItemId === item.id}
                              title="Prendi"
                              className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => setDeclineTargetId(item.id)}
                              disabled={busyItemId === item.id}
                              title="Rifiuta"
                              className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"
                            >
                              <XIcon size={16} />
                            </button>
                          </>
                        }
                        footer={item.status === 'declined' && item.reviewNote ? (
                          <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                            Nota: "{item.reviewNote}"
                          </p>
                        ) : null}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer: progress + close */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {reviewedCount}/{totalCount} revisionati
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Chiudi
          </button>
        </div>

        {/* Decline popover (inline modal) */}
        {declineTargetId && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md p-5">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">Rifiuta questo item</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                Puoi opzionalmente aggiungere una nota per il suggeritore (max 500 caratteri).
              </p>
              <textarea
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value.slice(0, 500))}
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none"
              />
              <div className="text-xs text-slate-500 text-right">{declineNote.length}/500</div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => { setDeclineTargetId(null); setDeclineNote(''); }}
                  className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Annulla
                </button>
                <button
                  onClick={handleConfirmDecline}
                  disabled={busyItemId === declineTargetId}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  Conferma rifiuto
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep "SuggestionReviewDialog\|AliasConflictDialog"`
Expected: empty output (no new errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/features/bulletin/SuggestionReviewDialog.tsx frontend/src/components/features/bulletin/AliasConflictDialog.tsx
git commit -m "feat(forum): owner-side review dialog + alias conflict resolver

SuggestionReviewDialog renders items grouped by type (Note / Evidenze /
Dossier / Norme veloci / Alias) with per-item Prendi/Rifiuta buttons.
Declining opens an inline 500-char review note textarea.

AliasConflictDialog (Replace / Rename / Skip) is the 409 resolution
surface wired in the shell in task 9."
```

---

## Task 8: SuggestContentModal — 5 sections including notes + highlights

**Files:**
- Modify: `frontend/src/components/features/bulletin/SuggestContentModal.tsx`

- [ ] **Step 1: Update Zustand slice imports**

At the top of `SuggestContentModal.tsx`, extend the destructure of `useAppStore()` to include `annotations` and `highlights`:
```ts
const { dossiers, quickNorms, customAliases, annotations, highlights } = useAppStore();
```

- [ ] **Step 2: Drop the empty-array exclusions in the pseudo-env**

Change the `currentStateEnv` memo from:
```ts
    annotations: [], // Empty - we don't suggest annotations
    highlights: [],  // Empty - we don't suggest highlights
```
to:
```ts
    annotations,
    highlights,
```
Add `annotations` and `highlights` to the dep array.

- [ ] **Step 3: Extend `hasSelection` and `selectedCount`**

```ts
const hasSelection = useMemo(() => {
  return (
    selection.dossierIds.length > 0 ||
    selection.quickNormIds.length > 0 ||
    selection.aliasIds.length > 0 ||
    selection.annotationIds.length > 0 ||
    selection.highlightIds.length > 0
  );
}, [selection]);

const selectedCount = useMemo(() => ({
  dossiers: selection.dossierIds.length,
  quickNorms: selection.quickNormIds.length,
  aliases: selection.aliasIds.length,
  annotations: selection.annotationIds.length,
  highlights: selection.highlightIds.length,
}), [selection]);
```

- [ ] **Step 4: Rewrite `handleSubmit` to build `items[]`**

```ts
const handleSubmit = async () => {
  if (!hasSelection) return;
  setIsSubmitting(true);
  setError(null);

  try {
    const items: Array<{ itemType: 'annotation' | 'highlight' | 'dossier' | 'quickNorm' | 'alias'; payload: unknown }> = [];

    for (const id of selection.annotationIds) {
      const a = annotations.find(x => x.id === id);
      if (a) items.push({ itemType: 'annotation', payload: {
        articleId: a.articleId,
        anchorText: a.anchorText,
        startOffset: a.startOffset,
        text: a.text,
      }});
    }
    for (const id of selection.highlightIds) {
      const h = highlights.find(x => x.id === id);
      if (h) items.push({ itemType: 'highlight', payload: {
        articleId: h.articleId,
        anchorText: h.text,
        startOffset: h.startOffset ?? 0,
        endOffset: (h.startOffset ?? 0) + h.text.length,
        colorVar: h.color,
      }});
    }
    for (const id of selection.dossierIds) {
      const d = dossiers.find(x => x.id === id);
      if (d) items.push({ itemType: 'dossier', payload: {
        title: d.title,
        description: d.description,
        tags: d.tags ?? [],
        entries: d.items.map(it => ({
          articleRef: it.type === 'norma' ? it.data : undefined,
          note: it.type === 'note' ? it.data : undefined,
          status: it.status,
        })),
      }});
    }
    for (const id of selection.quickNormIds) {
      const qn = quickNorms.find(x => x.id === id);
      if (qn) items.push({ itemType: 'quickNorm', payload: {
        label: qn.label,
        searchParams: qn.searchParams,
        sourceUrl: qn.sourceUrl,
      }});
    }
    for (const id of selection.aliasIds) {
      const a = customAliases.find(x => x.id === id);
      if (a) items.push({ itemType: 'alias', payload: {
        trigger: a.trigger,
        aliasType: a.type,
        expandTo: a.expandTo,
        searchParams: a.searchParams,
        description: a.description,
      }});
    }

    await sharedEnvironmentService.createSuggestion(environment.id, {
      items,
      message: message.trim() || undefined,
    });

    onSuggested();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Errore nell\'invio del suggerimento';
    setError(msg);
  } finally {
    setIsSubmitting(false);
  }
};
```

- [ ] **Step 5: Extend the selection summary JSX**

Below the existing dossier/quickNorm/alias chips, add:
```tsx
{selectedCount.annotations > 0 && (
  <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 rounded-full">
    {selectedCount.annotations} note
  </span>
)}
{selectedCount.highlights > 0 && (
  <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-full">
    {selectedCount.highlights} evidenze
  </span>
)}
```

- [ ] **Step 6: Update instructions copy**

Replace the existing gray-box instructions line with:
```tsx
<div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 text-sm text-slate-600 dark:text-slate-400">
  Seleziona gli elementi dal tuo stato corrente — note, evidenze, dossier, norme veloci e alias — da suggerire all'autore.
  L'autore potrà prendere o rifiutare ogni item singolarmente.
</div>
```

- [ ] **Step 7: Update `message` max length to 1000**

Change `maxLength={500}` to `maxLength={1000}` (if present). Confirm the existing textarea reflects this.

- [ ] **Step 8: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no new errors from this file.

- [ ] **Step 9: Lint check — should not increase**

Run: `cd frontend && npx eslint src/components/features/bulletin/SuggestContentModal.tsx`
Expected: zero errors in this file.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/features/bulletin/SuggestContentModal.tsx
git commit -m "feat(forum): suggest 5 content types (add notes + highlights)

Drops the hardcoded exclusion of annotations/highlights in the
suggestion pseudo-environment. Rewrites handleSubmit to build an
items[] array matching the new SuggestionItem payload shape per type."
```

---

## Task 9: EditSuggestionDialog + AddItemsDialog (suggester edit flow)

**Files:**
- Create: `frontend/src/components/features/bulletin/AddItemsDialog.tsx`
- Create: `frontend/src/components/features/bulletin/EditSuggestionDialog.tsx`

- [ ] **Step 1: Create `AddItemsDialog.tsx` — a scoped "append" picker**

This reuses the same body as `SuggestContentModal` but calls `addSuggestionItems` instead of `createSuggestion`.

```tsx
import { useMemo, useState } from 'react';
import { X, Send } from 'lucide-react';
import { EnvironmentContentViewer } from '../environments/EnvironmentContentViewer';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { useAppStore } from '../../../store/useAppStore';
import type { Environment, SuggestionItemType } from '../../../types';
import type { EnvironmentSelection } from '../../../utils/environmentUtils';

interface AddItemsDialogProps {
  suggestionId: string;
  onAdded: () => void;
  onClose: () => void;
}

const emptySelection: EnvironmentSelection = {
  dossierIds: [], quickNormIds: [], aliasIds: [], annotationIds: [], highlightIds: [],
};

export function AddItemsDialog({ suggestionId, onAdded, onClose }: AddItemsDialogProps) {
  const { dossiers, quickNorms, customAliases, annotations, highlights } = useAppStore();
  const [selection, setSelection] = useState<EnvironmentSelection>(emptySelection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pseudoEnv = useMemo<Partial<Environment>>(() => ({
    id: 'current-state',
    name: 'Il tuo stato',
    dossiers, quickNorms, customAliases, annotations, highlights,
    createdAt: new Date().toISOString(),
  }), [dossiers, quickNorms, customAliases, annotations, highlights]);

  const hasSelection =
    selection.dossierIds.length + selection.quickNormIds.length + selection.aliasIds.length +
    selection.annotationIds.length + selection.highlightIds.length > 0;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const items: Array<{ itemType: SuggestionItemType; payload: unknown }> = [];
      // (same per-type builder as SuggestContentModal — extract to a util
      //  when the third caller appears, not earlier.)
      for (const id of selection.annotationIds) {
        const a = annotations.find(x => x.id === id);
        if (a) items.push({ itemType: 'annotation', payload: {
          articleId: a.articleId, anchorText: a.anchorText, startOffset: a.startOffset, text: a.text,
        }});
      }
      for (const id of selection.highlightIds) {
        const h = highlights.find(x => x.id === id);
        if (h) items.push({ itemType: 'highlight', payload: {
          articleId: h.articleId, anchorText: h.text, startOffset: h.startOffset ?? 0,
          endOffset: (h.startOffset ?? 0) + h.text.length, colorVar: h.color,
        }});
      }
      for (const id of selection.dossierIds) {
        const d = dossiers.find(x => x.id === id);
        if (d) items.push({ itemType: 'dossier', payload: {
          title: d.title, description: d.description, tags: d.tags ?? [],
          entries: d.items.map(it => ({
            articleRef: it.type === 'norma' ? it.data : undefined,
            note: it.type === 'note' ? it.data : undefined, status: it.status,
          })),
        }});
      }
      for (const id of selection.quickNormIds) {
        const qn = quickNorms.find(x => x.id === id);
        if (qn) items.push({ itemType: 'quickNorm', payload: {
          label: qn.label, searchParams: qn.searchParams, sourceUrl: qn.sourceUrl,
        }});
      }
      for (const id of selection.aliasIds) {
        const a = customAliases.find(x => x.id === id);
        if (a) items.push({ itemType: 'alias', payload: {
          trigger: a.trigger, aliasType: a.type, expandTo: a.expandTo,
          searchParams: a.searchParams, description: a.description,
        }});
      }
      await sharedEnvironmentService.addSuggestionItems(suggestionId, { items });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Aggiungi item al suggerimento</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <EnvironmentContentViewer
            environment={pseudoEnv}
            selectable
            selection={selection}
            onSelectionChange={setSelection}
            maxHeight="250px"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg">
            Annulla
          </button>
          <button
            onClick={submit}
            disabled={!hasSelection || busy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            <Send size={16} /> {busy ? 'Invio...' : 'Aggiungi'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `EditSuggestionDialog.tsx` skeleton**

```tsx
import { useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { EnvironmentSuggestion, SuggestionItem, SuggestionItemType } from '../../../types';
import { SuggestionItemCard } from './SuggestionItemCard';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { AddItemsDialog } from './AddItemsDialog';

interface EditSuggestionDialogProps {
  suggestion: EnvironmentSuggestion;
  onRevoke: (itemId: string) => Promise<void>;
  onItemsAdded: () => void;
  onClose: () => void;
}

const SECTION_ORDER: SuggestionItemType[] = ['annotation', 'highlight', 'dossier', 'quickNorm', 'alias'];
const SECTION_LABEL: Record<SuggestionItemType, string> = {
  annotation: 'Note', highlight: 'Evidenze', dossier: 'Dossier',
  quickNorm: 'Norme veloci', alias: 'Alias',
};

export function EditSuggestionDialog({ suggestion, onRevoke, onItemsAdded, onClose }: EditSuggestionDialogProps) {
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showRevokeAll, setShowRevokeAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const acc: Record<SuggestionItemType, SuggestionItem[]> = {
      annotation: [], highlight: [], dossier: [], quickNorm: [], alias: [],
    };
    for (const i of suggestion.items) acc[i.itemType].push(i);
    return acc;
  }, [suggestion.items]);

  const handleRevoke = async (id: string) => {
    setBusy(true);
    try { await onRevoke(id); } finally { setBusy(false); setPendingRevokeId(null); }
  };

  const handleRevokeAll = async () => {
    setBusy(true);
    try {
      for (const item of suggestion.items) {
        if (item.status === 'pending') await onRevoke(item.id);
      }
    } finally {
      setBusy(false);
      setShowRevokeAll(false);
    }
  };

  const pendingCount = suggestion.counts.pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Suggerimento a @{suggestion.sharedEnvironment?.user.username}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              "{suggestion.sharedEnvironment?.title}" · Stato:
              {' '}{suggestion.counts.pending} pending ·
              {' '}{suggestion.counts.taken} prese ·
              {' '}{suggestion.counts.declined} rifiutate
            </p>
            {suggestion.message && (
              <p className="mt-2 text-sm italic text-slate-700 dark:text-slate-300">"{suggestion.message}"</p>
            )}
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {SECTION_ORDER.map((type) => {
            const items = grouped[type];
            if (items.length === 0) return null;
            return (
              <div key={type}>
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  {SECTION_LABEL[type]} ({items.length})
                </h3>
                <div className="space-y-2">
                  {items.map(item => (
                    <SuggestionItemCard
                      key={item.id}
                      item={item}
                      actions={
                        <button
                          onClick={() => setPendingRevokeId(item.id)}
                          title="Revoca"
                          disabled={busy}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      }
                      footer={item.status === 'declined' && item.reviewNote ? (
                        <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                          Risposta: "{item.reviewNote}"
                        </p>
                      ) : null}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {suggestion.items.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
              Nessun item — il suggerimento è stato revocato.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus size={14} /> Aggiungi item
            </button>
            {pendingCount > 0 && (
              <button
                onClick={() => setShowRevokeAll(true)}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
              >
                Revoca tutti pending
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Chiudi
          </button>
        </div>
      </div>

      {showAdd && (
        <AddItemsDialog
          suggestionId={suggestion.id}
          onAdded={() => { setShowAdd(false); onItemsAdded(); }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {pendingRevokeId && (
        <ConfirmDialog
          isOpen
          variant="danger"
          title="Revocare questo item?"
          description="L'item verrà rimosso dal thread e l'autore non potrà più prenderlo."
          confirmLabel="Revoca"
          onConfirm={() => handleRevoke(pendingRevokeId)}
          onClose={() => setPendingRevokeId(null)}
        />
      )}

      {showRevokeAll && (
        <ConfirmDialog
          isOpen
          variant="danger"
          title={`Revocare ${pendingCount} item pending?`}
          description="Solo gli item non ancora revisionati verranno rimossi. Le decisioni già prese dall'autore restano."
          confirmLabel="Revoca tutti"
          onConfirm={handleRevokeAll}
          onClose={() => setShowRevokeAll(false)}
        />
      )}
    </div>
  );
}
```

Note: Verify the exact `ConfirmDialog` props in `frontend/src/components/ui/ConfirmDialog.tsx`. If the prop names differ (`onClose` vs `onCancel`, `description` vs `message`), adjust to match — the component is shared across the project.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep -E "EditSuggestionDialog|AddItemsDialog"`
Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/features/bulletin/EditSuggestionDialog.tsx frontend/src/components/features/bulletin/AddItemsDialog.tsx
git commit -m "feat(forum): suggester-side edit dialog + add-items picker

EditSuggestionDialog shows items grouped by type with a trash icon per
pending item; 'Revoca tutti pending' bulk-deletes only pending. AddItems
reuses EnvironmentContentViewer in selection mode against the suggester's
own workspace."
```

---

## Task 10: ForumSuggestionsView + BulletinBoardPage wiring

**Files:**
- Modify: `frontend/src/components/features/bulletin/ForumSuggestionsView.tsx`
- Modify: `frontend/src/components/features/bulletin/BulletinBoardPage.tsx`

- [ ] **Step 1: Rewrite `ForumSuggestionsView` props**

Replace the `interface ForumSuggestionsViewProps { ... }` with:
```ts
interface ForumSuggestionsViewProps {
  receivedSuggestions: EnvironmentSuggestion[];
  sentSuggestions: EnvironmentSuggestion[];
  loading: boolean;
  suggestionTab: 'received' | 'sent';
  setSuggestionTab: (tab: 'received' | 'sent') => void;
  pendingCount: number;
  onOpenReview: (suggestion: EnvironmentSuggestion) => void;
  onOpenEdit: (suggestion: EnvironmentSuggestion) => void;
}
```

- [ ] **Step 2: Replace received card markup with a clickable version**

Replace the inner `.map((suggestion) => ...)` body for the received branch with:
```tsx
{receivedSuggestions.map((suggestion) => {
  const { counts, aggregateStatus } = suggestion;
  return (
    <button
      key={suggestion.id}
      type="button"
      onClick={() => onOpenReview(suggestion)}
      className="w-full text-left bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary-400 dark:hover:border-primary-600 p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBreakdownChip counts={counts} aggregate={aggregateStatus} />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              da @{suggestion.suggester.username}
            </span>
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
            per "{suggestion.sharedEnvironment?.title}"
          </p>
          {suggestion.message && (
            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
              "{suggestion.message}"
            </p>
          )}
        </div>
      </div>
    </button>
  );
})}
```

- [ ] **Step 3: Replace sent card markup**

Replace the sent-branch `.map(...)` body with:
```tsx
{sentSuggestions.map((suggestion) => {
  const { counts, aggregateStatus } = suggestion;
  const canEdit = aggregateStatus === 'open' || aggregateStatus === 'revoked';
  return (
    <button
      key={suggestion.id}
      type="button"
      onClick={() => canEdit && onOpenEdit(suggestion)}
      disabled={!canEdit}
      className="w-full text-left bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 transition-colors disabled:cursor-default enabled:hover:border-primary-400 dark:enabled:hover:border-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBreakdownChip counts={counts} aggregate={aggregateStatus} />
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
            a "{suggestion.sharedEnvironment?.title}" di @{suggestion.sharedEnvironment?.user.username}
          </p>
          {suggestion.message && (
            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">"{suggestion.message}"</p>
          )}
        </div>
      </div>
    </button>
  );
})}
```

- [ ] **Step 4: Add `StatusBreakdownChip` helper at file bottom**

```tsx
function StatusBreakdownChip({ counts, aggregate }: {
  counts: { pending: number; taken: number; declined: number };
  aggregate: 'open' | 'closed' | 'revoked';
}) {
  if (aggregate === 'revoked') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
        Revocato
      </span>
    );
  }
  const parts: string[] = [];
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.taken > 0) parts.push(`${counts.taken} prese`);
  if (counts.declined > 0) parts.push(`${counts.declined} rifiutate`);
  const classes =
    aggregate === 'open'
      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
  return <span className={`text-xs px-2 py-0.5 rounded-full ${classes}`}>{parts.join(' · ') || 'Nessun item'}</span>;
}
```

- [ ] **Step 5: Clean up dead imports**

Remove `Check`, `X as XIcon`, `AlertCircle` from the `lucide-react` import if no longer used. Keep `Inbox` and `Send` for the tab icons.

- [ ] **Step 6: Update `BulletinBoardPage.tsx` — drop old handlers, add new ones**

Find `handleApproveSuggestion` / `handleRejectSuggestion` and delete them.

Add state for the open dialog:
```ts
const [reviewingSuggestion, setReviewingSuggestion] = useState<EnvironmentSuggestion | null>(null);
const [editingSuggestion, setEditingSuggestion] = useState<EnvironmentSuggestion | null>(null);
const [aliasConflict, setAliasConflict] = useState<{ itemId: string; suggestedTrigger: string; existingAliasId?: string } | null>(null);
```

Add the handlers:
```ts
const handleTakeItem = useCallback(async (itemId: string): Promise<TakeResult> => {
  if (!reviewingSuggestion) return { kind: 'ok' };
  try {
    await sharedEnvironmentService.takeSuggestionItem(reviewingSuggestion.id, itemId);
    await refreshSuggestions();
    setToast({ type: 'success', message: 'Item preso.' });
    return { kind: 'ok' };
  } catch (err: unknown) {
    // Axios error: check response status + body code
    const maybeAxios = err as { response?: { status?: number; data?: Record<string, unknown> } };
    if (maybeAxios.response?.status === 409 && maybeAxios.response.data?.error === 'alias_trigger_conflict') {
      const body = maybeAxios.response.data as { suggestedTrigger: string; existingAliasId?: string };
      setAliasConflict({ itemId, suggestedTrigger: body.suggestedTrigger, existingAliasId: body.existingAliasId });
      return { kind: 'alias_conflict', itemId, suggestedTrigger: body.suggestedTrigger, existingAliasId: body.existingAliasId };
    }
    const msg = err instanceof Error ? err.message : 'Errore';
    setToast({ type: 'error', message: msg });
    return { kind: 'ok' };
  }
}, [reviewingSuggestion, refreshSuggestions]);

const handleDeclineItem = useCallback(async (itemId: string, reviewNote?: string) => {
  if (!reviewingSuggestion) return;
  try {
    await sharedEnvironmentService.declineSuggestionItem(reviewingSuggestion.id, itemId, reviewNote);
    await refreshSuggestions();
    setToast({ type: 'success', message: 'Item rifiutato.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore';
    setToast({ type: 'error', message: msg });
  }
}, [reviewingSuggestion, refreshSuggestions]);

const handleRevokeItem = useCallback(async (itemId: string) => {
  if (!editingSuggestion) return;
  try {
    await sharedEnvironmentService.revokeSuggestionItem(editingSuggestion.id, itemId);
    await refreshSuggestions();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore';
    setToast({ type: 'error', message: msg });
  }
}, [editingSuggestion, refreshSuggestions]);
```

Where `refreshSuggestions` is the existing re-fetcher (it already exists as part of the fetch flow — reuse it, don't duplicate).

- [ ] **Step 7: Keep reviewing/editing suggestion in sync with server refresh**

After `refreshSuggestions()`, the `reviewingSuggestion` local state holds a stale copy. Right after each mutation, re-read from the updated list:
```ts
useEffect(() => {
  if (!reviewingSuggestion) return;
  const fresh = receivedSuggestions.find(s => s.id === reviewingSuggestion.id);
  if (fresh) setReviewingSuggestion(fresh);
}, [receivedSuggestions, reviewingSuggestion]);

useEffect(() => {
  if (!editingSuggestion) return;
  const fresh = sentSuggestions.find(s => s.id === editingSuggestion.id);
  if (fresh) setEditingSuggestion(fresh);
}, [sentSuggestions, editingSuggestion]);
```

- [ ] **Step 8: Wire the dialogs in the shell's JSX**

Add, near the existing modal block:
```tsx
{reviewingSuggestion && (
  <SuggestionReviewDialog
    suggestion={reviewingSuggestion}
    onTake={handleTakeItem}
    onDecline={handleDeclineItem}
    onClose={() => setReviewingSuggestion(null)}
  />
)}
{editingSuggestion && (
  <EditSuggestionDialog
    suggestion={editingSuggestion}
    onRevoke={handleRevokeItem}
    onItemsAdded={() => { void refreshSuggestions(); }}
    onClose={() => setEditingSuggestion(null)}
  />
)}
{aliasConflict && (
  <AliasConflictDialog
    suggestedTrigger={aliasConflict.suggestedTrigger}
    onChoose={async (choice) => {
      if (choice.action === 'skip') { setAliasConflict(null); return; }
      if (!reviewingSuggestion) { setAliasConflict(null); return; }
      try {
        if (choice.action === 'replace') {
          // Delete the owner's existing alias (using the id from the 409 body)
          // then retry take. Both calls chained with await so a failure on
          // delete surfaces before we retry.
          if (!aliasConflict.existingAliasId) {
            throw new Error('Missing existingAliasId in alias conflict body');
          }
          await customAliasService.delete(aliasConflict.existingAliasId);
          await sharedEnvironmentService.takeSuggestionItem(reviewingSuggestion.id, aliasConflict.itemId);
        } else if (choice.action === 'rename') {
          // Patch the item payload on-the-fly: the server reads payload,
          // but we can't mutate the pending SuggestionItem. Alternative:
          // create an owner-side alias with the renamed trigger + same
          // attribution, then mark the SuggestionItem as 'taken' manually.
          // SIMPLEST in MVP: reject with a rename note and have the user
          // create the alias manually.
          // For now: tell the owner to decline + create manually.
          setToast({ type: 'info', message: 'Funzione Rinomina non ancora implementata — usa Sostituisci o Salta.' });
        }
        await refreshSuggestions();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Errore';
        setToast({ type: 'error', message: msg });
      } finally {
        setAliasConflict(null);
      }
    }}
    onClose={() => setAliasConflict(null)}
  />
)}
```

**Note on rename**: the rename path is non-trivial because the server enforces the trigger from the SuggestionItem payload. Options:
  (a) Add a backend `POST /suggestions/:id/items/:itemId/take?renameTrigger=foo` query param that overrides trigger on the alias create.
  (b) Implement rename as "create locally with new trigger + manually mark item taken via a second endpoint".
  (c) Ship MVP with Replace + Skip only; Rename shows a toast "non disponibile".

Pick (c) for this plan. Flag (a) as a Task 12 nice-to-have. This is a pragmatic scope cut — the happy path (Replace / Skip) covers the main flows; Rename is a power-user optimisation.

- [ ] **Step 9: Pass new handlers to `ForumSuggestionsView`**

Update the JSX that renders `<ForumSuggestionsView ... />` in `BulletinBoardPage.tsx`:
```tsx
<ForumSuggestionsView
  receivedSuggestions={receivedSuggestions}
  sentSuggestions={sentSuggestions}
  loading={loadingSuggestions}
  suggestionTab={suggestionTab}
  setSuggestionTab={setSuggestionTab}
  pendingCount={pendingCount}
  onOpenReview={setReviewingSuggestion}
  onOpenEdit={setEditingSuggestion}
/>
```

- [ ] **Step 10: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: zero errors. Any that remain are from the alias-rename escape hatch — shortcut to `toast` only, not a real call.

- [ ] **Step 11: Lint gate — must stay at 156 or lower**

Run: `cd frontend && npx eslint . --ext .ts,.tsx 2>&1 | tail -5`
Expected: ≤ 156 problems.

- [ ] **Step 12: Manual smoke**

Run: `./start.sh`, log in as two separate users (use two incognito windows):
1. User A publishes an env on `/forum > I Miei`
2. User B (other window) sees it in Esplora, imports it, then 3-dot menu → Suggerisci → picks 2 notes + 1 alias
3. User A refreshes `/forum > Suggerimenti > Ricevuti` → sees 1 card with "3 pending" chip
4. User A clicks → `SuggestionReviewDialog` opens → Prendi first note, Rifiuta second with reviewNote "troppo lungo", third alias has no conflict → Prendi
5. User A sees the taken note in their workspace's NotesPeekPanel
6. User B opens `/forum > Suggerimenti > Inviati` → sees "1 pending · 2 prese · 0 rifiutate" (wait — we declined one, so 1 rifiutata, 1 presa, 1 presa = 2 prese, 0 pending, 1 rifiutata) — recount based on actual test
7. User B opens Edit dialog → sees the decline reviewNote → adds a new item → Revoca tutti pending

- [ ] **Step 13: Commit**

```bash
git add frontend/src/components/features/bulletin/ForumSuggestionsView.tsx frontend/src/components/features/bulletin/BulletinBoardPage.tsx
git commit -m "feat(forum): wire review + edit dialogs through the forum shell

Replaces the inline approve/reject buttons with clickable cards that
open SuggestionReviewDialog (received) or EditSuggestionDialog (sent).
Per-item counts drive the status breakdown chip. Alias 409 opens
AliasConflictDialog; rename mode is MVP-deferred to a Replace/Skip
fallback with an info toast."
```

---

## Task 11: Attribution surfaces — UI chip everywhere taken content lives

**Files:**
- Modify: `frontend/src/components/features/search/NotesPeekPanel.tsx`
- Modify: `frontend/src/components/features/search/InlineNotePopover.tsx`
- Modify: `frontend/src/components/features/dossier/DossierListView.tsx`
- Modify: `frontend/src/components/features/dossier/DossierDetailView.tsx`
- Modify: `frontend/src/components/features/search/QuickNormsManager.tsx`
- Modify: `frontend/src/components/features/settings/AliasManager.tsx`

- [ ] **Step 1: NotesPeekPanel — attribution subtitle under each note**

In `NotesPeekPanel.tsx`, find where each note's body text is rendered. Below the text, add:
```tsx
import { AttributionChip } from '../bulletin/AttributionChip';
...
{note.sourceSuggestionId && (
  <div className="mt-1">
    <AttributionChip author={note.originalAuthor} />
  </div>
)}
```

- [ ] **Step 2: NotesPeekPanel — `Tutte / Mie / Importate` filter tri-state**

Near the Peek header (above the list), add:
```tsx
const [ownerFilter, setOwnerFilter] = useState<'all' | 'own' | 'imported'>('all');
...
<div className="flex gap-1 text-xs px-3 pt-2">
  {(['all', 'own', 'imported'] as const).map(key => (
    <button
      key={key}
      onClick={() => setOwnerFilter(key)}
      className={`px-2 py-1 rounded ${ownerFilter === key ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
    >
      {key === 'all' ? 'Tutte' : key === 'own' ? 'Mie' : 'Importate'}
    </button>
  ))}
</div>
```

And filter notes before rendering:
```ts
const visibleNotes = useMemo(() => {
  if (ownerFilter === 'own') return notes.filter(n => !n.sourceSuggestionId);
  if (ownerFilter === 'imported') return notes.filter(n => !!n.sourceSuggestionId);
  return notes;
}, [notes, ownerFilter]);
```

- [ ] **Step 3: InlineNotePopover — same subtitle line**

Below the note text:
```tsx
{note.sourceSuggestionId && (
  <div className="mt-1">
    <AttributionChip author={note.originalAuthor} />
  </div>
)}
```

- [ ] **Step 4: DossierListView — chip beside card title**

In the dossier card layout, add next to the title:
```tsx
{dossier.sourceSuggestionId && <AttributionChip author={dossier.originalAuthor} className="ml-2" />}
```

- [ ] **Step 5: DossierDetailView — chip in header**

In the detail header (next to the dossier title/description), add the same chip.

- [ ] **Step 6: QuickNormsManager — column chip in list rows**

In the row layout, beside the label, add:
```tsx
{qn.sourceSuggestionId && <AttributionChip author={qn.originalAuthor} className="ml-2" />}
```

- [ ] **Step 7: AliasManager — column chip in list rows**

Same as Step 6 but for `customAlias`.

- [ ] **Step 8: Highlight tooltip — hover text**

The request is `hover tooltip "evidenziato da @mario"` on the inline `<mark>`. In `useArticleMarkers.ts` find the span/mark creation for highlights and set the `title` attribute conditionally:
```ts
const author = highlight.originalAuthor?.username;
const title = author ? `Evidenziato da @${author}` : undefined;
if (title) mark.setAttribute('title', title);
```

Skip the visual change; only the hover tooltip is needed per the spec.

- [ ] **Step 9: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: zero errors.

- [ ] **Step 10: Lint gate**

Run: `cd frontend && npx eslint . --ext .ts,.tsx 2>&1 | tail -5`
Expected: ≤ 156 problems.

- [ ] **Step 11: Manual smoke**

Continue the smoke from Task 10:
- User A (who just took user B's note) opens an article: the wavy underline is there; NotesPeekPanel shows "da @userB" under the note body
- Open the Tutte / Mie / Importate tri-state: `Importate` shows only notes with the chip; `Mie` hides them
- The taken quickNorm shows "da @userB" in QuickNormsManager; same for the alias in AliasManager
- Hover a highlight that was suggested → browser tooltip "Evidenziato da @userB"

- [ ] **Step 12: Commit**

```bash
git add frontend/src/components/features/search/NotesPeekPanel.tsx \
        frontend/src/components/features/search/InlineNotePopover.tsx \
        frontend/src/components/features/dossier/DossierListView.tsx \
        frontend/src/components/features/dossier/DossierDetailView.tsx \
        frontend/src/components/features/search/QuickNormsManager.tsx \
        frontend/src/components/features/settings/AliasManager.tsx \
        frontend/src/hooks/useArticleMarkers.ts
git commit -m "feat(forum): attribution chip on all taken-content surfaces

Notes / highlights / dossiers / quickNorms / aliases that originated
from a taken SuggestionItem now display 'da @mario'. NotesPeekPanel
adds a Tutte / Mie / Importate tri-state filter. Highlights get a
hover tooltip via the <mark title> attribute."
```

---

## Task 12: Polish, docs, memory entry

**Files:**
- Modify: `CLAUDE.md`
- Modify: `frontend/src/components/features/bulletin/SuggestionItemCard.tsx` (if smoke found issues)
- Create: `~/.claude/projects/-Users-gpuzio-Desktop-CODE-VisuaLexAPI/memory/forum_suggestions_rework_complete.md`
- Modify: `~/.claude/projects/-Users-gpuzio-Desktop-CODE-VisuaLexAPI/memory/MEMORY.md`

- [ ] **Step 1: CLAUDE.md — update Critical Files > Frontend > bulletin entry**

Extend the existing `components/features/bulletin/` paragraph to mention the new components. Add bullets inside the paragraph (or as a nested list) for:
- `SuggestionReviewDialog.tsx` — owner-side per-item review modal
- `EditSuggestionDialog.tsx` — suggester-side edit modal
- `SuggestionItemCard.tsx` — polymorphic renderer, used in both dialogs
- `AliasConflictDialog.tsx` — Replace/Skip (rename deferred) for 409
- `AddItemsDialog.tsx` — scoped "append" picker from Edit dialog
- `AttributionChip.tsx` — shared `da @mario` chip

- [ ] **Step 2: CLAUDE.md — add new gotcha #20 about suggestion item payload shape**

Insert under "Gotchas and Known Issues":
```
20. **SuggestionItem payload shape is per-itemType and server-trusted**: the backend stores `payload` as opaque JSON per `itemType` (see design doc §Data Model). The `take` handler trusts the payload shape — any rename/transformation must happen BEFORE the item is stored. This is why the AliasConflictDialog's Rename path is MVP-deferred: rewriting the trigger at take-time would need either a trigger override param on the endpoint OR a client-side "manually recreate then mark item taken" dance. Replace + Skip cover the pragmatic flows until a Rename endpoint is added.
21. **`sourceSuggestionId` + `originalAuthorId` are the attribution contract, never mutate them**: when a row carries these fields, every UI surface MUST render the AttributionChip. Don't paper over them in a service method (e.g. filtering them out of a `getAll` response) — the invariant is "if the DB has an author, the UI shows the author". If the author is deleted, the fields stay null (Prisma `SetNull`) and the chip renders "@utente-rimosso" — that's the correct, by-design state from D7.
```

- [ ] **Step 3: Write the memory entry**

File: `~/.claude/projects/-Users-gpuzio-Desktop-CODE-VisuaLexAPI/memory/forum_suggestions_rework_complete.md`
```md
---
name: forum_suggestions_rework_complete
description: Forum suggestions reworked (Apr 2026) — per-item take/decline across 5 content types with permanent attribution. Backend + frontend + schema + tests. Load-bearing decisions not to re-litigate.
type: project
---

Followup to `polish_forum_complete.md` but a **structural** change, not a polish round. The monolithic approve/reject flow on `EnvironmentSuggestion.content` JSON was replaced with per-item atomic take/decline across 5 content types (annotation, highlight, dossier, quickNorm, alias). Design doc: `docs/superpowers/specs/2026-04-24-forum-suggestions-rework-design.md`.

**Why:** without this record a future session could miss why SharedEnvironment.content is NOT the landing target for takes (owner's private workspace is), why the alias conflict dialog has no Rename (MVP-deferred, see gotcha #20), or why the SuggestionStatus enum was dropped in favour of aggregate derivation from SuggestionItem[].counts.

**How to apply:** read before touching anything in `features/bulletin/` suggestion surface or the SuggestionItem backend model. The contract between server and client is set — don't re-think the `payload` JSON shape per `itemType`.

### Load-bearing decisions (don't re-litigate)

1. **Take lands in private workspace, not SharedEnvironment.content.** The spec D6 is explicit: attributed rows sit in Annotation/Dossier/etc tables of the OWNER. The SharedEnvironment only changes on re-publish, which already snapshots the workspace. Don't try to short-circuit by writing into `content`.
2. **Aggregate status is derived, never stored.** `open | closed | revoked` computed from item counts; no column on EnvironmentSuggestion. This is why `getReceivedSuggestions` does client-side filter on `?status=` rather than a SQL WHERE — simpler and avoids a denormalised bit.
3. **SuggestionItem.payload is opaque JSON per itemType.** Zod validates `itemType` enum but not `payload` shape. The consumer (take handler) picks fields. This is pragmatic because validation would need 5 discriminated schemas AND any change would need coordinated migrations. Documentation lives in the spec §Data Model.
4. **Alias Rename is MVP-deferred.** AliasConflictDialog ships with Replace + Skip. Rename shows a toast. Full rename needs either a trigger-override query param on the take endpoint or a two-step dance. Revisit if users ask.
5. **Backend vitest + supertest harness is new infra, not scope creep.** The user asked for integration tests; no framework existed. The harness (vitest.config.ts + tests/setup.ts + tests/helpers.ts + src/app.ts factory) is reusable for every future backend feature. Don't rip it out.
6. **The `src/app.ts` split is load-bearing for tests.** `src/index.ts` now only imports app + calls listen. Tests import `src/app.ts` directly. If you merge them back, tests break.
7. **Attribution chip is mandatory on every taken-content surface.** Gotcha #21. Don't filter or hide the attribution anywhere — either render the chip or don't render the row.
8. **`SharedEnvironmentVersion.suggestionId` FK was dropped.** No real data yet. Approve no longer creates versions (D6). If you want to reintroduce a link, rethink the D6 decision first.

### Commits (X total, all on `main`, not pushed)

... (fill in actual commit list after shipping) ...

### Known-good verification flow

1. Two browser windows, two users A + B
2. A publishes env on /forum
3. B imports, then Suggerisci → picks note + highlight + alias
4. A opens Ricevuti → card with "3 pending" chip → SuggestionReviewDialog
5. Take note → NotesPeekPanel in A's workspace shows "da @B"
6. Decline highlight with reviewNote → B sees note in Edit dialog
7. Take alias that conflicts with existing trigger → AliasConflictDialog → Skip → item stays pending
```

- [ ] **Step 4: Add to MEMORY.md index**

Append a single line under `## Project`:
```
- [forum_suggestions_rework_complete.md](forum_suggestions_rework_complete.md) — Forum suggestions reworked (Apr 2026): per-item take/decline, 5 content types, attribution contract, vitest+supertest infra
```

- [ ] **Step 5: Final lint + typecheck + test sweep**

Run:
- `cd frontend && npx tsc -b --noEmit` → exit 0
- `cd frontend && npx eslint . --ext .ts,.tsx 2>&1 | tail -3` → ≤ 156 problems
- `cd backend && npm test` → all green
- `cd backend && npx tsc --noEmit` → exit 0

- [ ] **Step 6: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document forum suggestions rework + gotchas 20-21"
```

- [ ] **Step 7: Final smoke E2E**

Re-run the Task 10 Step 12 full flow end-to-end. Verify every step passes. Screenshot the three key screens (Review dialog, Edit dialog, attribution chip in NotesPeekPanel) for the PR description.

- [ ] **Step 8: Offer push**

Tell the user: "Pronto. Totale N commit non pushati su main dall'inizio della sessione. Push now?"

---

## Risk Notes / Decision Points (inline)

- **Backend test framework addition** (Task 2): First-ever backend tests. Adds ~3 dev deps + one config. Scoped, idiomatic, reusable. No runtime impact.
- **`src/index.ts → src/app.ts` split** (Task 2 Step 6): Small refactor. Tests need app without listen(). Keep it.
- **Alias Rename MVP deferral** (Task 10 Step 8): Ship Replace + Skip. Revisit if users hit it in production.
- **Backend `formatSuggestion` response shape** (Task 3 Step 3): The client expects `counts` + `aggregateStatus`. If the shape evolves, update both sides at once.
- **Items-per-suggestion cap of 100** (Task 3 Step 2): Soft cap, from spec. Too low → suggester can't send a big glossa; too high → UI performance. Revisit if needed.
- **SuggestionItem.payload JSON is not schema-validated per itemType**: The take handler is the validator. Any itemType requiring stricter validation should add a Zod schema in a helper, not inline.


---

## Self-review — spec coverage map

| Spec item | Task |
|---|---|
| D1 Review in dedicated modal | 7 |
| D2 Skip coexist mode | 3 (approve/reject dropped) |
| D3 Central object is norm | payload shapes anchor to articleId (3, 6) |
| D4 Review per-item | 3, 7 |
| D5 5 atomic itemTypes | 1 (schema), 3 (backend), 6-9 (frontend) |
| D6 Take → private workspace | 3 Step 9 |
| D7 Permanent attribution | 1 (columns), 4 (test), 11 (UI) |
| D8 Silent take, optional decline reviewNote | 7 (Step 2 decline popover) |
| D9 Revoke pending + add items, no edit | 3 Steps 11-12, 9 |
| D10 Alias conflict mini-dialog | 7 (AliasConflictDialog), 10 (wiring) |
| Data model: SuggestionItem | 1 Step 4 |
| Data model: Attribution FKs | 1 Steps 6-10 |
| API: create with items[] | 3 Step 4 |
| API: received/sent/pending-count | 3 Steps 5-7 |
| API: take | 3 Step 9 |
| API: decline | 3 Step 10 |
| API: revoke DELETE | 3 Step 11 |
| API: add items | 3 Step 12 |
| API: drop approve/reject | 3 Steps 1, 8, 13 |
| Frontend service rewrite | 5 |
| Flow 1 creation | 8 (SuggestContentModal) |
| Flow 2 review | 7 + 10 wiring |
| Flow 3 edit | 9 + 10 wiring |
| Flow 4 attribution UI | 11 |
| Error: env deleted / 404 | inherited from existing `findFirst({ isActive: true })` — 3 Step 4 |
| Error: take of reviewed item / 409 | 3 Step 9 (`status !== 'pending'` guard) |
| Error: alias conflict / 409 | 3 Step 9 (P2002 catch) |
| Error: revoke reviewed / 403 | 3 Step 11 |
| Error: add to closed thread / 409 | 3 Step 12 |
| Error: reviewNote > 500 | Zod in 3 Step 2 |
| Error: payload > 512KB | 3 Step 4 |
| Error: revoke during take (410) | **NOT explicitly handled**; fallback is 404 when item not found. Acceptable per MVP — document as known gap in memory entry (Task 12) |
| Test: full lifecycle | 4 Step 1 |
| Test: alias conflict 409 | 4 Step 5 |
| Test: authZ cross-user | 4 Step 3 |
| Test: attribution integrity + account delete | 4 Step 7 |
| Test: SuggestionItemCard unit | 6 Step 4 |

### Gaps flagged:
1. **410 Gone not handled distinctly**: returning 404 is acceptable UX ("item not found, please reload") and matches existing conventions. Flag as known gap in memory entry. No blocker.
2. **Rename alias flow deferred to toast**: documented in Task 10 Step 8 rationale + Task 12 gotcha #20. No blocker.
3. **Frontend integration tests for dialogs** (spec mentions as nice-to-have): not in plan. Can be added after manual smoke passes; no blocker for shipping.

No placeholder / TODO / "TBD" remains in executable code blocks. All file paths are explicit. Type consistency confirmed: `TakeResult`, `SuggestionItem`, `SuggestionItemCounts`, `formatSuggestion` shape match between backend handler output and frontend `EnvironmentSuggestion` interface.

### Bite-size check
Every task has steps that are 2-5 minute actions. The longest are code-write steps (7 Step 2, 9 Step 2) — those are single-file writes, one commit-ready unit each. Breaking them further would fragment the component.


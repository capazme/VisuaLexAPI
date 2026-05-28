# MERL-T Forum Signal Authoring — `target_author_id`

**Status:** Decided 2026-05-23 — Slice 1, Story MERLT-1.10
**Open question reference:** design doc §10.3

---

## Context

Forum (ex Bulletin Board) emits 4 community signals to MERL-T as RLCF
authority inputs:

- `forum:like` — user toggles like on a SharedEnvironment
- `forum:download` — user downloads/imports a SharedEnvironment
- `forum:suggestion_accepted` — owner takes an item from a suggestion
- `forum:suggestion_declined` — owner declines an item from a suggestion

Each signal needs a `target_author_id`: the user whose **authority** is
incremented (positive signal) or noted (declined). Three reasonable
attribution targets exist:

| Option | Source of target_author_id | When it makes sense |
|---|---|---|
| **A** | `originalAuthorId` of the SharedEnvironment receiving the action | "the env owner gets credit for every interaction with their env" |
| **B** | `originalAuthorId` of the SuggestionItem (the suggester) | "credit follows who produced the content, not who hosts it" |
| **C** | Doubled emission: 50/50 to env owner + suggester | "compromise, more complex pipeline" |

---

## Decision: Option B (per-actor attribution)

`target_author_id` is the user who **originated the content being signalled**:

| Action | target_author_id |
|---|---|
| `forum:like` | env.user.id (env owner) |
| `forum:download` | env.user.id (env owner) |
| `forum:suggestion_accepted` | suggestion.suggester.id |
| `forum:suggestion_declined` | suggestion.suggester.id |

For like and download there is no separate suggester — the env owner
*is* the originator. For suggestion accept/decline the attribution
**must** flow to the suggester, otherwise the system credits the env
owner for accepting external work (which would erode the incentive to
contribute).

---

## Why not Option A

Option A treats authority as "host points" — every interaction with an
env credits the owner. This breaks the suggestion economy: a suggester
who contributes a perfect item earns nothing while the owner accumulates
authority just by maintaining a popular env. Disincentive to suggest.

## Why not Option C (split)

Splitting attribution 50/50 requires emitting **two** signals per
suggestion accept/decline, with a half-weighted score. MERL-T's
TrackingBatch supports it (just send `events: [a, b]`), but the
weighting must be carried in metadata and the RLCF aggregator must
know how to interpret it. Out of scope for Slice 1 — possible
follow-up in Slice 3+ if the data shows the simpler attribution
mis-allocates credit.

---

## Per-content-chain attribution (deferred)

`SuggestionItem.payload` can carry an `originalAuthorId` field when the
item was itself sourced from a third party (re-suggestion chain — see
gotcha #21 of CLAUDE.md). The full chain logic would walk the
`sourceSuggestionId` graph to find the *ultimate* author.

For Slice 1, the BFF takes `suggestion.suggester.id` as the
attribution target, not the deep chain. This is correct for the common
case (direct suggester) and only loses precision in the
re-suggestion-of-re-suggestion case, which is rare and Slice 3+ can
revisit by hardening the payload contract.

---

## Implementation map (where this decision lives in code)

**Frontend call-sites** (where `original_author_id` is set in the
publishMerltEvent metadata):

- `components/features/bulletin/BulletinBoardPage.tsx`
  - `handleLike` → `env.user.id`
  - `handleTakeItem` → `reviewingSuggestion.suggester.id`
  - `handleDeclineItem` → `reviewingSuggestion.suggester.id`
- `components/features/bulletin/ImportEnvironmentModal.tsx`
  - `handleImport` → `sharedEnvironment.user.id`

**Subscriber** that consumes the metadata and builds the payload:

- `features/merlt/tracking/useForumSignalTracker.ts`
  - reads `metadata.original_author_id` directly — the route does
    not decide attribution, the call-site does.

**BFF route** that forwards to MERL-T:

- `backend/src/routes/merlt/events.ts` — `POST /events/forum-signal`
  - passes payload through `toMerltForumSignal` unchanged.

**MERL-T payload field** (after mapping):

- `target_author_id` (snake_case) — opaque string for MERL-T's
  in-memory tracking buffer.

---

## Revisit triggers

This decision should be revisited if any of the following observations
emerge from MERL-T's authority logs:

1. Suggesters with high `forum:suggestion_accepted` rates show no
   meaningful authority bump → attribution mis-flowing somewhere.
2. Env owners with no suggestion activity accumulate authority from
   accepted suggestions → attribution leaking to host.
3. Users complain that authority feels detached from their actual
   contributions → the simple per-actor model is too coarse.

In any of these cases, Slice 3+ should either move to Option C
(split) or implement the deep-chain walk via
`sourceSuggestionId` traversal.

# MERL-T Slice 3 — UX Integration Design

> **Status**: approved by product owner (2026-07-02)
> **Input**: systematic 5-lens frontend review (architecture, MERL-T surfaces, vanilla
> touchpoints, live browser walkthrough with a full-consent user, promised-vs-shipped
> audit vs slice design docs). Evidence citations throughout refer to that review.
> **Goal**: make the MERL-T integrations useful and practical for the end user
> (Italian lawyer/student) **without obstructing the vanilla flow**
> (search norm → read → annotate → organize → share).

---

## 1. Review verdict (context)

The integration is architecturally sound: no vanilla flow ever waits on MERL-T
(fire-and-forget everywhere), consent is honest (server SoT, banner only on the
first genuinely-tracked action), heavy graph code is lazy-loaded, a consent-none
user pays ~10 KB. The best surface is the smallest one — the NER "Citazione
corretta? ✓✗✏" row inside the citation popup: zero friction, in context,
gated correctly. **That is the pattern to replicate.**

The three defects that touch users daily:
1. **RLCF events duplicated ×N** — the 3 "global" tracker hooks are mounted per
   article card (`ArticleMerltSlot.tsx:40-46`); with N articles open every
   highlight/note/bookmark fires N identical POSTs, corrupting the very training
   signal the integration exists to collect; dossier-adds outside an article are
   lost entirely.
2. **Infinite "Sto indicizzando…" spinner** — a failed ingestion trigger is
   swallowed (`ArticleGraphSideRail.tsx:54-58`) and polling has no cap
   (`useIngestionJob.ts`): "slow" and "broken" are indistinguishable.
3. **The graph rail covers the text** — 320px `fixed` overlay with no reflow
   (`ArticleGraphSideRail.tsx:74,82`); observed live covering the selected line;
   ~85% of the screen on mobile.

Invisible value: Q&A has no in-context entry point (the question is born while
reading a norm); sources — "non-negotiable" per the design — are collapsed inside
the deliberation panel; `/merlt/chiedi` (the documented path) renders a blank page;
4/8 validation-queue proposals are pipeline junk offered for community vote.

---

## 2. Product decisions (owner, 2026-07-02)

| # | Decision | Choice |
|---|---|---|
| D1 | Navigation posture | **One sidebar entry "Assistente"** (the hub). The "Grafo" entry is removed; graph is reached from the hub and from the in-article rail; Cronologia moves back up. |
| D2 | What consent buys | **"Reading is free, teaching requires consent."** Graph readable by everyone (already the server policy); Q&A queryable from `basic`; `full` gates only the teaching channels (feedback, contributions, validation votes). Resolves the hub/sidebar/BFF split-brain. |
| D3 | Hub role | **Hub-dashboard**: the hub becomes the primary MERL-T destination, enriched with live data (pending-validation count, last Q&A question, activity, consent state). Not a corridor of static cards. |
| D4 | Dirty data in community surfaces | **Keep surfaces open; community cleans via votes.** Consequence (design obligation): downvoting junk must be effortless — every proposal shows provenance + link to the norm + one-tap reject. Risk accepted and monitored (see §7). |

Design principles that follow:
- **Vanilla-first** (unchanged): core flows never wait on, or visually compete
  with, MERL-T.
- **In-context first, hub as home base**: value appears where the user works
  (article view, citation popup); the hub aggregates and orients (D3).
- **Consent ladder as a showcase**: read → ask → teach. Each level up is
  motivated by what the user already experienced at the previous one (D2).
- **Failure honesty**: every MERL-T surface must distinguish "loading" /
  "unavailable" / "needs consent" and never trap the user in a spinner.

---

## 3. Surface designs

### 3.1 Navigation + routing (D1)
- Sidebar: single entry **"Assistente"** → `/merlt` (hub). Icon: sparkles or
  scale-of-justice variant; label never an acronym. Gated on `VITE_FEATURE_MERLT`
  (flag off → entry absent, `/merlt*` renders "non disponibile").
- Remove the "Grafo" sidebar entry; `/grafo` stays routable (deeplinks, hub card,
  rail node-click) — it is a destination, not a menu item.
- Redirect `/merlt/chiedi` → `/merlt/qa` (docs path must work). Add a global 404
  route (vanilla fix, but surfaced by this review).

### 3.2 Consent model in the FE (D2)
- `useMerltFeatures` becomes the single derivation point:
  `graphReadable = merltEnabled` (no consent), `qaAskable = level ≥ basic`,
  `canTeach = level === full` (feedback/contrib/validate). Hub, sidebar, rail and
  pages all read these — no local re-derivations (kills the split-brain:
  `useMerltFeatures.ts:41` vs `Sidebar.tsx:250-252`).
- Q&A page: composing/asking gated on `qaAskable`; the 4 feedback channels and
  "ricorda nel grafo" gated on `canTeach` with a compact inline upsell
  ("Per insegnare a MERL-T serve il consenso completo → attiva").
- Consent banner: triggers also on first `article_viewed` (route the event
  through the bus like the other 4 — today the read-only majority never
  discovers MERL-T); "Non ora" persists a 30-day snooze (localStorage).
- ConsentDialog copy updated to the ladder: "Leggere è libero. Con il consenso
  base fai domande. Con quello completo insegni al sistema."

### 3.3 Hub-dashboard (D3)
The hub earns its place as primary destination with live data. Layout: 2-column
card grid (1-column mobile), every card actionable and data-bearing:
- **Assistente Q&A**: last question + answer-confidence chip, "Riprendi" +
  "Nuova domanda". Empty state: one example question, one tap to ask it.
- **Valida proposte**: live pending count (`GET /validate/pending` count-only),
  "N proposte in attesa del tuo voto" → `/merlt/valida`. Zero → "Nessuna proposta
  in attesa" (not hidden).
- **Grafo**: visible to everyone (D2), mini-stats (nodes count from `/health` or
  cached), "Esplora" → `/grafo`.
- **I miei contributi**: last extraction job status, promoted-count,
  "Carica appunti" → `/merlt/contribuisci`.
- **Consenso & privacy**: current level, ladder visual, change/revoke actions
  (wire the existing `revokeConsent` DELETE — today dead code).
- **Profilo**: replace the bare "Authority 0.44" with a human explanation
  ("Il peso del tuo voto: ★★☆ — cresce validando e contribuendo") + link to a
  short "come funziona" popover.
- **Ops (admin only)**: unchanged (training button + NER stats), behind
  `opsVisible`.
- Header: remove stale "(presto)" copy (`MerltHubPage.tsx:90-91`).
- Data policy: each card fetches independently, fail-soft per card (a dead
  MERL-T never blanks the hub; cards show "non raggiungibile" pill).

### 3.4 Graph rail (redesign)
- **One mount at workspace level** (not per article card), bound to the focused
  article; opening it **reflows** the reading column (no overlay over text) on
  desktop ≥1280px; below that it opens as an overlay from the right with a
  scrim; on mobile it becomes a **bottom-sheet** (~55% height, swipe to dismiss).
- States: `loading` (skeleton ≤60s budget) / `ingesting` (progress + "puoi
  continuare a leggere, te lo segnalo io" + auto-refetch on completion) /
  `error-consent` (403 → "il grafo si costruisce col consenso base → attiva") /
  `error-unavailable` (5xx/timeout → "Grafo non raggiungibile — riprova più
  tardi" + retry button). The ingestion poll stops at the budget; never an
  unbounded spinner.
- Node labels: never raw Normattiva URLs — display "Art. N — <atto>" (FE
  formatting fallback while the pipeline label fix lands, see §5).

### 3.5 Q&A surface
- **In-context entry point**: "Chiedi su questo articolo" action in the article
  toolbar (plugin slot `article_content_after`), prefills the Q&A composer with
  the article context (urn + heading). Visible at `qaAskable`; at consent none
  shows once as a teaser chip that opens the consent dialog (dismiss persists).
- **Sources always visible**: provenance chips move OUT of the collapsed
  "Come ci sono arrivato" panel, rendered directly under the answer; the
  deliberation panel keeps the reasoning narrative only. History-reloaded turns
  that carry no sources must not ask for a source rating ("FONTI CONSULTATE (0)"
  + rating request undermines trust).
- **Waiting UX** (queries can take up to 120s): elapsed-time indicator, Annulla
  (AbortController), composer stays editable, question preserved on error with
  a Riprova button; error copy in Italian.
- Composer never cleared on submit-failure. "Dev" toggle behind `opsVisible`.

### 3.6 Validation queue (D4 consequences)
Queue stays open to all `canTeach` users, junk included — therefore:
- Every proposal card shows **provenance** (chi/che pipeline l'ha proposta,
  quando) and a **link to the source norm** (opens the article in a tab).
- **One-tap reject** with optional quick-reasons ("errore di pipeline",
  "duplicato", "non pertinente") — the effortless downvote IS the cleaning tool.
- "Salta" action to defer without voting.
- Vote submission: optimistic removal reverts on failure with a retry toast
  (today the vote is silently lost — `ValidationPage.tsx:46-61`, violates the
  no-silent-catch repo rule).

### 3.7 NER feedback row (keep, minor polish)
- Keep exactly as designed; move the row **below** the popup's primary action.
- Replicate the pattern (one discreet line, in-context, `canTeach`-gated) as the
  reference for any future teaching affordance.

### 3.8 Contribution page (polish)
- Promotion button when disabled shows a per-requirement checklist
  (fonte ✓ / riformulazione ✗ / dichiarazione ✗) instead of a generic disabled
  state — the copyright gate must be legible to a lawyer.
- Relations path stays visible but marked "in arrivo" (extractor produces
  entities only — honest label instead of a dead affordance).

### 3.9 Tracking correctness (invisible but foundational)
- Move `useHighlightAnnotationTracker`, `useDossierBookmarkTracker`,
  `useCitationTracker` from `ArticleMerltSlot` (per-card) to `GlobalMerltSlot`
  (single mount) — same pattern as the forum tracker. Fixes ×N duplication and
  the lost out-of-article dossier events.
- `article_viewed` also published on the bus (enables banner trigger, §3.2).

---

## 4. Phased plan

### P1 — Quick wins (one working session; no decision dependencies)
| Item | Size | Ref |
|---|---|---|
| Move 3 tracker hooks to GlobalMerltSlot (fix ×N events) | S | §3.9 |
| Ingestion spinner → error states (403 vs 5xx) + poll budget + retry | M | §3.4 |
| ValidationPage: revert + retry toast on failed vote | S | §3.6 |
| Redirect `/merlt/chiedi` → `/merlt/qa` + global 404 route | S | §3.1 |
| Sidebar: single "Assistente" entry, flag-gated; Cronologia up | S | §3.1 |
| Hub: remove "(presto)"; graph card visible per D2 | S | §3.3 |
| "Dev" toggle behind `opsVisible` | S | §3.5 |
| Consent banner: 30-day persisted snooze | S | §3.2 |
| Q&A: preserve question on error + Riprova; Italian error copy | S | §3.5 |
| NER row below primary popup action | S | §3.7 |
| Lazy-load MerltHubPage + GraphExplorerPage | S | review |

### P2 — Redesigns (decision-shaped)
| Item | Size | Ref |
|---|---|---|
| Hub-dashboard build-out (live cards, fail-soft, profile humanized) | L | §3.3 (D3) |
| Graph rail: workspace-level single mount, reflow desktop, bottom-sheet mobile | M/L | §3.4 |
| Consent ladder in `useMerltFeatures` + Q&A gating at basic + dialog copy | M | §3.2 (D2) |
| "Chiedi su questo articolo" in-article entry + prefill | M | §3.5 |
| Sources always visible in Q&A turn; no rating on zero sources | M | §3.5 |
| Q&A waiting UX (elapsed, cancel, non-blocking composer) | M | §3.5 |
| Validation cards: provenance + norm link + one-tap reject + salta | M | §3.6 (D4) |
| ContribPage promotion checklist | S/M | §3.8 |
| Vanilla (surfaced by review): `useAuth` → context (20+ `GET /auth/me` per load); workspace dock remembers collapse | M | review |

### P3 — Nice-to-have
| Item | Size |
|---|---|
| Granular consent toggles UI (or drop the schema columns — decide) | M |
| Availability pill "MERL-T non raggiungibile" shared across surfaces | M |
| Consent audit list + real revoke (DELETE) UI in hub | S |
| Multi-select promotion; "Salva vista" on `/grafo`; G6 prefetch on rail hover | M |
| Docs alignment: CLAUDE.md (Cytoscape→G6, `/merlt/chiedi`→`/merlt/qa`), smoke checklist | S |

Order rule: complete P1 before any P2; inside P2, the tracking/consent
foundations (rows 1–3) before the visibility items.

---

## 5. Cross-stack dependencies (not FE work, tracked here)

- **Pipeline label quality**: lazy-ingested nodes carry raw Normattiva URLs as
  labels; junk proposals reach the validation queue (4/8 observed live). D4
  keeps surfaces open, but an upstream anti-junk filter in confirm-source and
  ingestion labelling ("Art. N — atto") remains the real fix (MERL-T Python).
- **Concept nodes in `/grafo` search**: search proposes concept nodes the page
  cannot open ("Articolo non indicizzabile") — needs either a concept-node
  detail view (FE) or filtered search results (MERL-T).

## 6. Non-goals
- No new MERL-T capabilities (no new expert types, no relation extraction UI —
  entities-first stays).
- No changes to the RLCF backend contracts (all BFF routes stay as shipped and
  E2E-verified on 2026-07-02).
- No workspace/dossier redesign beyond the two vanilla fixes listed in P2.

## 7. Risks (accepted + monitored)
- **D4 (junk visible to community)** — accepted by the owner. Mitigations are
  design obligations in §3.6 (provenance, norm link, one-tap reject). Monitor:
  ratio of reject-votes with reason "errore di pipeline"; if junk consistently
  dominates the queue after the first real users, re-open the freeze/filter
  decision.
- **D3 (hub-dashboard)** — more live fetches on hub load; mitigated by per-card
  fail-soft and count-only endpoints where possible.
- **Rail reflow** — reflowing the reading column may shift text while reading;
  mitigate with a CSS transition and by preserving scroll anchor on toggle.

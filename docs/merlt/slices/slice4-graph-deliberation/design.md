# MERL-T Slice 4 — Il dibattito sul grafo (graph as deliberation & steering surface)

> **Status**: owner decisions locked 2026-07-03. North-star:
> [[merlt-graph-deliberation-vision]] — `/grafo` becomes the surface where the
> jurist SEES the machine's legal reasoning, STEERS it toward better directions,
> and TEACHES the policy-head weights (Loop β co-evolution made visible +
> steerable). Input: two review workflows (5-lens graph/deliberation review +
> 2-lens co-evolution probe). Visual proposal: scratchpad `grafo-dibattito.html`.
> Every claim below traces to file:line from those reviews.

## 1. Why

`/grafo` today is a mute explorer; the multi-expert deliberation ("il dibattito")
lives in a separate `/merlt/qa` chat. Yet the join already exists (source chips
carry `node_id`) and the graph holds 28,151 nodes / 15 relation types of real
multi-canon corpus per article. The reasoning is ~80% already on the wire
(`pipeline_trace` reaches the FE, read by `QaProcessTrace.tsx`); the learning
machine (3 REINFORCE heads gating/traversal/tool, checkpoints, boot-load,
admin training) is fully built and closed for gating+tool. What's missing is
(a) surfacing the reasoning ON the graph, and (b) making the jurist's steering
actually train the weights — today it largely doesn't.

## 2. Owner decisions (locked)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| A | /grafo ↔ /merlt/qa | **Absorb** — the graph is the SOLE Q&A surface; `/merlt/qa` is removed (redirect → `/grafo`). | Chat history must NOT be thrown: it lives as a **history view inside the deliberation column** on `/grafo`. The hub Q&A card, the "Chiedi su questo articolo" entry, and the sidebar all point to `/grafo`. |
| B | Literalness of "reasoning on the graph" | **Static highlight in P1** (light source nodes + canon arcs), animated traversal opt-in later (P3). | A lawyer wants to see WHICH nodes, not watch them appear. |
| C | Surface hierarchy | **Equal dignity, distinct roles**: graph = structure ("how it got there"), panel = prose ("what comes out"). | Neither is ornament; the lawyer reads the conclusion and verifies on the graph. |
| D | Show DISSENT | **Yes, in P2** — widen the API to surface disagreement + devil's advocate. | Small serializer add (data already produced by the synthesizer, dropped at the DTO). Restores 2 of the 4 RLCF pillars. |
| E | Teaching depth (the vision's core) | **L2 — directional steering that actually trains.** | Route `preferredExpert` to gating (today thrown away) + authority-weight the heads. Integration work, no new ML. L3 (per-relation/per-node, traversal head wired to inference) is a later phase. |

## 3. Target experience (the narrative)

A lawyer opens `/grafo` on art. 2043. They don't search a node — they **ask**
(a distinct "Chiedi al grafo…" field, prefilled with the centered article). Then:
1. **The four canons enter** — canon nodes (Letterale/Sistematico/Principi/
   Precedente) light around the article, size/opacity ∝ routing weight; those
   not consulted stay dim. The cast of the debate, made visible.
2. **Sources light up as nodes, not chips** — `retrieved_sources` land on the
   canvas colored by provenance (seed = solid, community_validated = ringed,
   live_unconfirmed = dashed amber) and trust. The lawyer sees the Precedente
   leaned on two unconfirmed massime while the Letterale stands on solid seed text.
3. **Each canon claims its sources** — a canon-colored arc links each expert to
   the nodes it grounds on; clicking a Norma opens "who says what".
4. **Dissent is an arc, not a paragraph** (P2) — when canons diverge, a dashed
   red "contrasto" arc joins two canon nodes, thickness ∝ `conflict_score`;
   hover shows the reason + the art. 12 preleggi ordering; a devil's-advocate
   dissent is marked as a deliberate challenge, not an organic split.
5. **The synthesis stays readable prose**, anchored — in the right panel; in-prose
   citations highlight the corresponding node on hover.
6. **You teach in place** — on a cited node you steer: confirm/contest a source,
   and (L2) "weigh this canon more" — which actually trains the weights (§5).

Consent ladder honored: graph readable by all; asking unlocks at `basic`;
teaching affordances (confirm/contest/steer) at `full` (`canContribute`), server
`consentGuard`/`contributionGuard` as defense in depth. Vanilla-first.

## 4. Screen architecture

- **Canvas** (center ~600px): the graph; colors nodes by trust/provenance,
  lights canons, draws contrast arcs on a response. Density control: "nascondi
  giurisprudenza" promoted to a primary control (the one real legibility lever),
  default-on in debate mode; the deliberation lights only its ~6-10 source
  nodes, never all 584 sentenze of a hot article.
- **Deliberation column** (right ~400px, DOCKED, dual-tab): **Dibattito**
  (synthesis + convergent/divergent verdict + per-canon theses + sources-as-nodes
  + **history** sub-view — the absorbed chat) / **Nodo** (the current
  NodeDetailsDrawer + the finally-wired EdgeDetailsDrawer). Canvas reflows to
  `calc(100% − 400px)` — the pattern already exists in `useReflowReadingColumn`.
- **"Chiedi al grafo" field** (header): distinct from node-search, prefilled with
  the current center, submits to `/experts/query`.
- **Mobile**: panels become bottom-sheets; deliberation is the PRIMARY view
  (full-width sheet), the graph a "tap to expand" thumbnail — inverts the desktop
  hierarchy rather than compressing it.
- **URL-as-SoT preserved**: `urn/depth/layout/filtri` stay URL-driven; `trace_id`
  becomes a new param so "share this debate on this node" is a link (P3).

## 5. The teach-the-weights loop (Decision E = L2)

**Critical correction** (co-evolution probe vs the visual proposal): the proposal
says "teach in place, reusing confirm-source" — but `confirm-source` writes a
graph node, it does NOT feed any policy head (no gradient). Real teaching needs:

L2 scope (integration only, no new ML — the trainer, checkpoints, boot-load exist):
- **Route `preferredExpert` to gating** — today `_wire_feedback_to_training`
  hardcodes `reward = 0.5` and discards the canon identity
  (`experts_router.py:444`); wire it into the per-expert gating gradient with
  reward shaping (template = the working tool head `SHAPING_BETA`,
  `policy_gradient.py:1046`). This turns "pesa di più questo canone" into a real
  gradient. **[MERL-T Python]**
- **Authority-weight the live heads** — add `advantage = authority·(reward −
  baseline)` in `update_from_feedback` (today absent on all 3 live heads; grep
  authority = 0 in training_scheduler/policy_gradient/replay_buffer). One
  multiplication; the senior jurist moves the weights more than the novice
  (dynamic-authority pillar). **[MERL-T Python]**
- Keep `source.relevance → TraversalPolicy` (the one targeted signal that already
  works, `traversal_training_service.py:96`).

Deferred to **L3** (later phase, real net-new): wire the trained `TraversalPolicy`
into per-query inference (today `add_graph_traversal` has no callers; systemic
uses a static relation list `systemic.py:315`); add `preferred_relation` /
`node_preference` feedback types; extend `TraversalPolicy.forward` with
`expert_type` (`traversal_training_service.py:264`).

## 6. Phased plan

### P1 — "il dibattito accade sul grafo" (ALL FE, engine untouched)
| Item | Size | Note |
|---|---|---|
| Fix `massima_text` → `massima` in NodeDetailsDrawer | S | unlocks the legal content on ~90% of nodes (sentenze) |
| "Chiedi al grafo" field in header → `/experts/query` | M | first ask affordance on /grafo |
| Docked dual-use right column (Dibattito / Nodo), reuse `useReflowReadingColumn` | M | persistent home for the synthesis |
| Sources-as-nodes: join `retrieved_sources` by `node_id`/`urn`, color by provenance/trust | M | the anchor bridge; pure FE join, no new contract |
| Widen `graphTransform.ts` → carry `properties`/`metadata` (provenance/trust) into the canvas | S | so the canvas colors nodes, not just the drawer |
| Promote "nascondi giurisprudenza" to a primary control + re-fit | S | the buried legibility lever |
| **Absorb**: redirect `/merlt/qa` → `/grafo`; history view inside the deliberation column; repoint hub card + "Chiedi su questo articolo" + sidebar | M | Decision A — sole Q&A surface, history preserved |

### P2 — "il dibattito visibile" + real steering (needs backend)
| Item | Size | Owner |
|---|---|---|
| Widen `ExpertQueryResponse`: `disagreement_analysis` + `devils_advocate_flag` (already serialized, dropped at DTO) | M | BE — Decision D |
| Canon nodes around the article (size ∝ routing weight) | M | FE |
| Contrast arc between canons (thickness ∝ `conflict_score`) + reason on hover | M | FE — restores Uncertainty Preservation |
| Per-canon attribution: resolve `expert="combined"` (`experts_router.py:155`) | L | BE — unlocks "who cited what" arcs |
| Wire `edge:click` → `EdgeDetailsDrawer` (already built, orphaned) | S | FE |
| **L2 teaching**: route `preferredExpert` → gating + authority weighting (§5) | M | BE — the first REAL teach-the-weights |
| "Pesa di più questo canone" / confirm / contest controls on nodes+canons | M | FE — gated on `canContribute` |

### P3 — polish + L3 foundations
| Item | Size | Owner |
|---|---|---|
| Rank the precedent flood (year, Sez. Unite, trust) — 584 sentenze → top-N | M | FE |
| Mobile bottom-sheet + fit-to-viewport | M | FE |
| `trace_id` in URL → shareable debate link | S | FE |
| L3: traversal head wired to inference + per-relation/per-node steering | L | BE |
| Animated traversal of `reasoning_steps` (opt-in "play") | L | BE |

**Fault line**: all of P1 is FE-only (demonstrates the vision without touching
Python). The first BE change is the DTO widening in P2 (a widening, not new
inference). The only engine-L in P2 (per-canon attribution) is isolable/deferrable.

## 7. Not touched
RLCF training architecture (no new ML), consent ladder, BFF contracts (except the
P2 DTO widening + the L2 feedback routing), the graph seed, entities-first. The
`/merlt/qa` route is removed but `useQaThread` (the state hook) is REUSED, not
rewritten — "absorb" migrates the surface, not the logic.

## 8. Risks
- **Density (#1)**: adding canons/sources/arcs over a 180-node hairball worsens
  noise. Mitigation: "nascondi giurisprudenza" default in debate mode; precedent
  ranking (P3) as a de-facto prerequisite; light only the ~6-10 deliberation nodes.
- **Latency (120s cold-start Q&A on a canvas)**: a frozen graph reads as broken.
  Mitigation: graph stays interactive during the wait; canons appear dim and
  "light up" per stage via `pipeline_trace.stage_times_ms`; explicit "il collegio
  sta deliberando…" in the panel, never on the canvas.
- **Mobile**: unusable today; a 400px column has nowhere to go. Mitigation:
  deliberation-primary bottom-sheet, graph as thumbnail (P3).
- **Consent**: teaching affordances are full-consent; gate on `canContribute`,
  server guards as defense in depth; the graph stays readable with no consent.

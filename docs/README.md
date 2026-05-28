# Documentazione — VisuaLexAPI

Indice della documentazione del progetto **VisuaLexAPI**: applicazione per avvocati italiani (Python Quart API · Node BFF · React SPA) con il sottosistema **MERL-T** (grafo giuridico collaborativo + RLCF) integrato come sidecar.

> **Nota.** Tutta questa documentazione descrive **VisuaLexAPI** (questo repo). `ALIS_CORE` è solo il riferimento **upstream** da cui provengono la visione e la libreria `merlt/`: lo leggiamo, non ci sviluppiamo.

**Legenda:** ✅ autorevole/attuale · 🧭 panoramica · 📓 registro (lavoro concluso) · ⚠️ parzialmente superato · 🕰️ storico (pre-MERL-T)

---

## Inizia da qui

1. 🧭 **[merlt/system-map.md](./merlt/system-map.md)** — *la mappa*: implementato vs. target, i due loop RLCF, matrice esistente/target, incongruenze aperte. **Leggi prima questo.**
2. ✅ **[merlt/glossary.md](./merlt/glossary.md)** — glossario (URN, RLCF, authority, net_score, Loop α/β…).
3. ✅ **[merlt/smoke-checklist.md](./merlt/smoke-checklist.md)** — smoke E2E Slice 1→2c; di fatto un «manifesto di cosa è costruito».
4. ✅ **[merlt/upstream-sync.md](./merlt/upstream-sync.md)** — cosa è vendorizzato in `merlt/` e perché (leggere prima di toccare il Python).

Prodotto base (non-MERL-T): [architecture.md](./architecture.md) · [backend/](./backend/) · [frontend/](./frontend/).

---

## MERL-T (`docs/merlt/`)

### Panoramica & riferimento
- 🧭 [system-map.md](./merlt/system-map.md) — mappa del sistema.
- ✅ [glossary.md](./merlt/glossary.md) — glossario.
- ✅ [smoke-checklist.md](./merlt/smoke-checklist.md) — smoke E2E, tutte le slice.
- ✅ [upstream-sync.md](./merlt/upstream-sync.md) — sync del codice vendorizzato.
- ✅ [seed-libro-iv.md](./merlt/seed-libro-iv.md) — seed del grafo (~27.7k nodi) + ricarica.
- ✅ [integration.md](./merlt/integration.md) — runbook avvio stack (con banner sullo stato reale).
- ✅ [contract-matrix.md](./merlt/contract-matrix.md) — contratto BFF→MERL-T (con banner: cosa è montato oggi).
- ⚠️ [execution-plan.md](./merlt/execution-plan.md) — piano d'esecuzione 11 fasi (parzialmente superato: Slice 1→2c fatte).

### Decisioni (ADR)
- ✅ [decisions/forum-authoring.md](./merlt/decisions/forum-authoring.md) — attribuzione dei segnali forum.

### Slice (design + sprint plan accoppiati)
| Slice | Design | Sprint plan |
|---|---|---|
| 1 — eventi RLCF | [design](./merlt/slices/slice1/design.md) | 📓 [sprint-plan](./merlt/slices/slice1/sprint-plan.md) |
| 2a — grafo read-only | [design](./merlt/slices/slice2a/design.md) | 📓 [sprint-plan](./merlt/slices/slice2a/sprint-plan.md) |
| 2b — hub & consenso | [design](./merlt/slices/slice2b/design.md) | 📓 [sprint-plan](./merlt/slices/slice2b/sprint-plan.md) |
| 2c — apprendi dagli appunti | [design](./merlt/slices/slice2c/design.md) | 📓 [sprint-plan](./merlt/slices/slice2c/sprint-plan.md) |
| RLCF loop closure | — | 📓 [sprint-plan](./merlt/slices/rlcf-loop/sprint-plan.md) |

### Prossimi passi
- 🧭 [coauth-ux-prompt.md](./merlt/coauth-ux-prompt.md) — brief UX co-autorialità (Loop α, fasi 3–7).

---

## Prodotto base (riferimento non-MERL-T)
- [architecture.md](./architecture.md) — topologia 3-service + sezione sidecar MERL-T.
- [backend/node_backend.md](./backend/node_backend.md) · [backend/python_api_reference.md](./backend/python_api_reference.md) · [backend/python_api_setup.md](./backend/python_api_setup.md)
- [frontend/setup.md](./frontend/setup.md) · [frontend/component_library.md](./frontend/component_library.md)
- [user_guide.md](./user_guide.md)

## Forum (feature non-MERL-T)
- [superpowers/specs/2026-04-24-forum-suggestions-rework-design.md](./superpowers/specs/2026-04-24-forum-suggestions-rework-design.md) — design del rework suggerimenti forum.

## Storia del prodotto (BMAD, mar 2026, pre-MERL-T) 🕰️
[product-brief](./product-brief-visualex-platform-2026-03-12.md) · [prd](./prd-visualex-platform-2026-03-12.md) · [architecture](./architecture-visualex-platform-2026-03-12.md) · [ux-design](./ux-design-visualex-platform-2026-03-15.md) · [sprint-plan](./sprint-plan-visualex-platform-2026-03-12.md) · [design-critique](./design-critique-2026-03-15.md). Tracker: [sprint-status.yaml](./sprint-status.yaml) · [bmm-workflow-status.yaml](./bmm-workflow-status.yaml).

---

## Convenzioni
- **Doc MERL-T** → `docs/merlt/` (panoramiche), `docs/merlt/slices/<slice>/` (design + sprint-plan accoppiati), `docs/merlt/decisions/` (ADR).
- **Design spec nuovi** → `docs/superpowers/specs/AAAA-MM-GG-<tema>-design.md`.
- Lingua: prosa **italiana**, identificatori/endpoint/percorsi in **inglese** (come nel codice).

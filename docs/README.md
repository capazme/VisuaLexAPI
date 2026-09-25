# Documentazione: VisuaLexAPI

Indice della documentazione del progetto **VisuaLexAPI**: applicazione per avvocati italiani (Python Quart API · Node BFF · React SPA) con il sottosistema **MERL-T** (grafo giuridico collaborativo + RLCF) integrato come sidecar sul branch `visualex-merlt-main`.

> **Nota.** Tutta questa documentazione descrive **VisuaLexAPI** (questo repo). `ALIS_CORE` è solo il riferimento **upstream** da cui provengono la visione e la libreria `merlt/`: lo leggiamo, non ci sviluppiamo.

**Legenda:** ✅ autorevole/attuale · 🧭 panoramica · 📓 registro (lavoro concluso) · ⚠️ parzialmente superato · 🕰️ storico (pre-MERL-T)

---

## Inizia da qui

1. ✅ **[merlt/blueprint.md](./merlt/blueprint.md)**: l'architettura MERL-T verificata sul codice (topologia, come pensa, come impara, dati, infra). **Leggi prima questo.**
2. ✅ **[merlt/integration.md](./merlt/integration.md)**: runbook da un clone vuoto a uno stack funzionante, con le variabili d'ambiente.
3. ✅ **[merlt/contract-matrix.md](./merlt/contract-matrix.md)**: ogni route montata sul BFF, con guard, flag, endpoint MERL-T e consumer FE.
4. ✅ **[merlt/smoke-checklist.md](./merlt/smoke-checklist.md)**: smoke E2E di tutte le superfici (Slice 1→4, Loop β, NER, ops).
5. 🧭 **[merlt/system-map.md](./merlt/system-map.md)**: la mappa esistente vs. target, i due loop RLCF, le incongruenze aperte.

Prodotto base (non-MERL-T): [architecture.md](./architecture.md) · [backend/](./backend/) · [frontend/](./frontend/) · [deployment.md](./deployment.md).

---

## MERL-T (`docs/merlt/`)

### Riferimento
- ✅ [blueprint.md](./merlt/blueprint.md): architettura verificata sul codice.
- ✅ [integration.md](./merlt/integration.md): runbook e variabili d'ambiente.
- ✅ [contract-matrix.md](./merlt/contract-matrix.md): contratto BFF → MERL-T, rigenerato dai router montati.
- ✅ [qa-async-progressive-contract.md](./merlt/qa-async-progressive-contract.md): contratto congelato della Q&A asincrona progressiva.
- ✅ [smoke-checklist.md](./merlt/smoke-checklist.md): smoke E2E di tutte le superfici.
- ✅ [glossary.md](./merlt/glossary.md): glossario (URN, RLCF, authority, net_score, Loop α/β, nodi provvisori…).
- ✅ [seed-libro-iv.md](./merlt/seed-libro-iv.md): seed del grafo (~27.7k nodi) e ricarica.
- ✅ [upstream-sync.md](./merlt/upstream-sync.md): cosa è vendorizzato in `merlt/`, come si sincronizza e le divergenze locali.
- 🧭 [system-map.md](./merlt/system-map.md): mappa esistente vs. target.
- ⚠️ [execution-plan.md](./merlt/execution-plan.md): piano d'esecuzione in 11 fasi, con lo stato di ogni fase al 2026-09-25.

### Decisioni (ADR)
- ✅ [decisions/forum-authoring.md](./merlt/decisions/forum-authoring.md): attribuzione dei segnali forum.

### Slice (design + sprint plan accoppiati)
| Slice | Design | Sprint plan |
|---|---|---|
| 1: eventi RLCF | [design](./merlt/slices/slice1/design.md) | 📓 [sprint-plan](./merlt/slices/slice1/sprint-plan.md) |
| 2a: grafo read-only | [design](./merlt/slices/slice2a/design.md) | 📓 [sprint-plan](./merlt/slices/slice2a/sprint-plan.md) |
| 2b: hub & consenso | [design](./merlt/slices/slice2b/design.md) | 📓 [sprint-plan](./merlt/slices/slice2b/sprint-plan.md) |
| 2c: apprendi dagli appunti | [design](./merlt/slices/slice2c/design.md) | 📓 [sprint-plan](./merlt/slices/slice2c/sprint-plan.md) |
| RLCF loop closure (Loop α) | — | 📓 [sprint-plan](./merlt/slices/rlcf-loop/sprint-plan.md) |
| Loop β: co-evoluzione Q&A | [spec](./merlt/slices/loop-beta-coevolution/spec.md) | 📓 [sprint-plan](./merlt/slices/loop-beta-coevolution/sprint-plan.md) |
| 3: UX e consenso (D1–D4) | [design](./merlt/slices/slice3-ux/design.md) · [data-quality-plan](./merlt/slices/slice3-ux/data-quality-plan.md) | — |
| 4: il dibattito sul grafo | [design](./merlt/slices/slice4-graph-deliberation/design.md) | — |
| Ingestion governance (admin) | [design](./merlt/slices/ingestion-governance/design.md) | — |

Design MERL-T scritti fuori da `docs/merlt/` (in `docs/superpowers/specs/`): [Q&A Fase F](./superpowers/specs/2026-05-31-merlt-loopbeta-phase-f-qa-ux-design.md), [NER via RLCF](./superpowers/specs/2026-05-31-merlt-ner-rlcf-design.md), [co-evoluzione del grafo](./superpowers/specs/2026-07-16-merlt-graph-coevolution-design.md).

### Registri e visione
- 📓 [overnight-2026-05-29-worklog.md](./merlt/overnight-2026-05-29-worklog.md): registro di una sessione di lavoro.
- 🧭 [vision/2026-08-25-sessioni-forkabili-vision.md](./merlt/vision/2026-08-25-sessioni-forkabili-vision.md): visione delle sessioni forkabili.
- 🧭 [coauth-ux-prompt.md](./merlt/coauth-ux-prompt.md): brief UX di co-autorialità (Loop α, fasi 3–7).

### Copie puntatore alla radice di `docs/`
[merlt-smoke-checklist.md](./merlt-smoke-checklist.md), [legacy-libro-iv-seed.md](./legacy-libro-iv-seed.md) e [sprint-plan-merlt-rlcf-loop-closure-2026-05-27.md](./sprint-plan-merlt-rlcf-loop-closure-2026-05-27.md) rimandano alla copia canonica in `docs/merlt/`.

---

## Prodotto base (riferimento non-MERL-T)
- [architecture.md](./architecture.md): topologia 3-service più la sezione sul sidecar MERL-T.
- [backend/node_backend.md](./backend/node_backend.md) · [backend/python_api_reference.md](./backend/python_api_reference.md) · [backend/python_api_setup.md](./backend/python_api_setup.md)
- [frontend/setup.md](./frontend/setup.md) · [frontend/component_library.md](./frontend/component_library.md)
- [user_guide.md](./user_guide.md)

## Forum (feature non-MERL-T)
- [superpowers/specs/2026-04-24-forum-suggestions-rework-design.md](./superpowers/specs/2026-04-24-forum-suggestions-rework-design.md): design del rework dei suggerimenti del forum.

## Storia del prodotto (BMAD, mar 2026, pre-MERL-T) 🕰️
[product-brief](./archive/bmad-2026-03/product-brief-visualex-platform-2026-03-12.md) · [prd](./archive/bmad-2026-03/prd-visualex-platform-2026-03-12.md) · [architecture](./archive/bmad-2026-03/architecture-visualex-platform-2026-03-12.md) · [ux-design](./archive/bmad-2026-03/ux-design-visualex-platform-2026-03-15.md) · [sprint-plan](./archive/bmad-2026-03/sprint-plan-visualex-platform-2026-03-12.md) · [design-critique](./archive/bmad-2026-03/design-critique-2026-03-15.md).

Tracker storici:

- [sprint-status.yaml](./sprint-status.yaml) segue solo gli sprint MERL-T 1a/1b.
- [bmm-workflow-status.yaml](./bmm-workflow-status.yaml) è un artefatto di marzo 2026.

---

## Convenzioni
- **Doc MERL-T** → `docs/merlt/` (panoramiche), `docs/merlt/slices/<slice>/` (design + sprint-plan accoppiati), `docs/merlt/decisions/` (ADR).
- **Design spec nuovi** → `docs/superpowers/specs/AAAA-MM-GG-<tema>-design.md`.
- Lingua: prosa **italiana**, identificatori/endpoint/percorsi in **inglese** (come nel codice).

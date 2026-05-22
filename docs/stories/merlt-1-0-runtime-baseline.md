---
story_id: MERLT-1.0
title: Runtime baseline & MERL-T copy
epic: EPIC-MERLT-1
sprint: MERLT-1a
priority: P0
points: 5
status: not_started
depends_on: []
gate: smoke runtime verde
skill_driver: "bmad:dev-story + feature-dev:code-architect"
---

# MERLT-1.0 — Runtime baseline & MERL-T copy

## User Story
Come dev che lavora su Slice 1
voglio un comando unico che avvii VisuaLex+MERL-T con tutte le dipendenze
così che posso iterare sull'integrazione senza setup manuale ricorrente.

## Acceptance Criteria
- [ ] `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/merlt/` esiste come copia integrale di `/Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/`
- [ ] Tag git `merlt-baseline-from-alis-core` creato sul commit di import
- [ ] `docker-compose.merlt.yml` esteso con 5 servizi: `merlt-api`, `falkordb`, `qdrant`, `redis-merlt`, `postgres-merlt`
- [ ] Healthcheck definito per ogni servizio
- [ ] `start.sh` rispetta `MERLT_ENABLED` e `MERLT_COMPOSE_ENABLED` env vars
- [ ] `MERLT_ENABLED=true ./start.sh` → `curl http://localhost:8000/health` ritorna 200 entro 60s
- [ ] `MERLT_ENABLED=false ./start.sh` → solo VisuaLex + dipendenze base partono
- [ ] `docs/merlt-upstream-sync.md` creato e dichiara `VisuaLexAPI/merlt/` come single source of truth

## Technical Notes
- Riusa la logica `MERLT_ENABLED` già presente nel commit `81be277` (start.sh)
- `postgres-merlt` separato da Postgres VisuaLex (due DB by design)
- Se `ALIS_CORE/merlt/` ha file di config con path assoluti, sistemarli post-copia
- Health gate in `start.sh`: aspetta MERL-T health 200 prima di proseguire (skip se `MERLT_ENABLED=false`)

## Dependencies
Nessuna (blocca tutte le altre story dello Slice 1)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Smoke manuale eseguito (container UP, health 200)
- [ ] Tag git creato e visibile via `git tag -l`
- [ ] Commit con messaggio Conventional Commits

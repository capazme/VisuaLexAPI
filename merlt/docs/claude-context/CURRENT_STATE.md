# MERL-T Current State

> **Aggiorna questo file alla fine di ogni sessione di lavoro**
> Claude legge questo file all'inizio di ogni conversazione

---

## Stato Attuale

| Campo | Valore |
|-------|--------|
| **Data ultimo aggiornamento** | 7 Gennaio 2026 |
| **Fase progetto** | **VisuaLex Integration - Sprint 2** |
| **Prossimo obiettivo** | Feature a media priorita' (Domain Authority, WebSocket, etc.) |
| **Blocchi attivi** | Nessuno |
| **Test Status** | 648/651 passed (99.5%) |

---

## Cosa E' Implementato (Gennaio 2026)

### Sistema RLCF Completo

| Componente | Stato | Note |
|------------|-------|------|
| **Pending Entities** | PostgreSQL | Persistenza completa, no in-memory |
| **Entity Voting** | Completo | Voti pesati per authority |
| **Relation Voting** | Completo | Stesso sistema delle entity |
| **Consensus Calculation** | Completo | Trigger automatici su threshold |
| **FalkorDB Write (Entity)** | Completo | `_write_entity_to_graph()` |
| **FalkorDB Write (Relation)** | Completo | `_write_relation_to_graph()` |
| **Issue Reporting** | Completo | Report + Vote + Reopen |
| **Issue Threshold Reopen** | Completo | Entity torna in `needs_revision` |

### API Endpoints Attivi

**Enrichment Router** (`/api/v1/enrichment/`):
- `POST /live` - Live enrichment articolo (SSE)
- `POST /validate-entity` - Vota su entity
- `POST /validate-relation` - Vota su relation
- `POST /propose-entity` - Proponi nuova entity
- `POST /propose-relation` - Proponi nuova relation
- `GET /pending` - Lista pending per validazione
- `POST /report-issue` - Segnala problema su nodo/relazione
- `POST /vote-issue` - Vota su issue esistente
- `GET /entity-issues/{id}` - Issue per un'entity
- `GET /open-issues` - Lista issue aperte

### Frontend VisuaLex Integrato

| Componente | File | Descrizione |
|------------|------|-------------|
| **MerltInspectorPanel** | `features/merlt/` | Panel validazione entita' |
| **ReportNodeIssueModal** | `features/merlt/` | Modal per segnalare issue |
| **IssueList** | `features/merlt/` | Lista issue con voti |
| **KnowledgeGraphExplorer** | `features/bulletin/` | Visualizzazione grafo |
| **NodeDetailsPanel** | `features/bulletin/` | Dettagli nodo + bottone segnala |

---

## Stato Database

| Storage | Nome | Contenuto |
|---------|------|-----------|
| **FalkorDB** | `merl_t_dev` | 27,740 nodi, 43,935 relazioni |
| **Qdrant** | `merl_t_dev_chunks` | 5,926 vectors |
| **PostgreSQL** | `rlcf_dev` | Pending entities, votes, issues |

**IMPORTANTE**: Usare sempre `_dev` in sviluppo.

---

## Feature Mancanti (Priorita')

### Media Priorita'
- [ ] Domain-Specific Authority (authority per dominio legale)
- [ ] Conversational Context (follow-up queries)
- [ ] WebSocket Real-time (push updates validazioni)
- [ ] Retry Sync Failed (background job)
- [ ] Source Excerpts (estratti testo in response)
- [ ] Authority Decay (decay per inattivita')

### Bassa Priorita'
- [ ] GraphQL API
- [ ] Batch Expert Queries
- [ ] Query Templates
- [ ] Streaming Responses

---

## Quick Reference

```bash
# Avviare ambiente
cd /Users/gpuzio/Desktop/CODE/MERL-T_alpha
source .venv/bin/activate

# Database
docker-compose -f docker-compose.dev.yml up -d

# Test
pytest tests/ -v  # 648+ test

# API Server
uvicorn merlt.app:app --reload --port 8000
```

---

## Contesto per Claude

### Cosa devi sapere:

- L'utente e' uno studente di giurisprudenza
- Tesi sulla "sociologia computazionale del diritto"
- **Sistema RLCF completo** con feedback loop
- **Integrazione VisuaLex** per frontend React
- Preferisce comunicare in italiano

### File chiave:

1. `CLAUDE.md` - Istruzioni generali progetto
2. `docs/claude-context/LIBRARY_VISION.md` - Principi guida
3. `merlt/api/enrichment_router.py` - API principale
4. `merlt/storage/enrichment/models.py` - Modelli SQLAlchemy

### Pattern da seguire:

- Zero duplicazioni
- Test con database reali (no mock)
- Documentazione italiana, codice inglese
- Commit frequenti con messaggi chiari

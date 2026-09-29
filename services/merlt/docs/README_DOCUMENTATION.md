# 📚 MERL-T & VisuaLex - Guida alla Documentazione

> **Creato:** 4 Gennaio 2026
> **Scopo:** Navigare facilmente l'intera codebase MERL-T e VisuaLex

---

## 🎯 Quick Start

**Se vuoi capire rapidamente dove cercare:**

| Domanda | Documento |
|---------|-----------|
| "Come è strutturato MERL-T?" | [MERL_T_ARCHITECTURE_MAP.md](./MERL_T_ARCHITECTURE_MAP.md) |
| "Quali feature sono implementate in MERL-T?" | [MERL_T_IMPLEMENTATION_STATUS.md](./MERL_T_IMPLEMENTATION_STATUS.md) |
| "Come è strutturato VisuaLex?" | [../VisuaLexAPI/docs/VISUALEX_ARCHITECTURE_MAP.md](../../VisuaLexAPI/docs/VISUALEX_ARCHITECTURE_MAP.md) |
| "Quali feature sono implementate in VisuaLex?" | [../VisuaLexAPI/docs/VISUALEX_IMPLEMENTATION_STATUS.md](../../VisuaLexAPI/docs/VISUALEX_IMPLEMENTATION_STATUS.md) |
| "Come comunicano MERL-T e VisuaLex?" | [INTEGRATION_MERL_T_VISUALEX.md](./INTEGRATION_MERL_T_VISUALEX.md) |

---

## 📖 Documentazione MERL-T

### 1. [MERL_T_ARCHITECTURE_MAP.md](./MERL_T_ARCHITECTURE_MAP.md)
**Mappa completa dell'architettura** della libreria Python `merlt`.

**Contenuto:**
- **12 moduli principali**: api, core, sources, storage, pipeline, experts, tools, rlcf, benchmark, disagreement, models, config
- **Per ogni modulo**: Scopo, Componenti chiave, Dipendenze, Entry points, Esempi di codice
- **Database schema**: FalkorDB, Qdrant, PostgreSQL, Redis
- **Testing strategy**: 311+ test, coverage 76%
- **Deployment stack**: Docker Compose

**Usa quando:**
- Devi capire dove si trova una funzionalità
- Vuoi estendere un modulo
- Debugging di un componente specifico
- Onboarding nuovo sviluppatore

---

### 2. [MERL_T_IMPLEMENTATION_STATUS.md](./MERL_T_IMPLEMENTATION_STATUS.md)
**Stato implementativo feature-by-feature** della libreria.

**Contenuto:**
- **70 feature tracciate** con status: ✅ Complete / 🚧 In Progress / ❌ Not Started / ⚠️ Unstable / 🔬 Experimental
- **Per ogni feature**: File, Test coverage, API endpoints, Database, Note tecniche
- **Dashboard riassuntiva**: 94.3% completezza (66/70 complete)
- **Database state attuale**: 27,740 nodi FalkorDB, 5,926 vectors Qdrant
- **Known issues & TODOs** prioritizzati

**Usa quando:**
- Vuoi sapere se una feature è implementata
- Pianifichi sviluppo di nuove feature
- Verifichi test coverage
- Prepari release notes

---

## 📖 Documentazione VisuaLex

### 3. [VISUALEX_ARCHITECTURE_MAP.md](../../VisuaLexAPI/docs/VISUALEX_ARCHITECTURE_MAP.md)
**Mappa completa dell'architettura** della piattaforma web VisuaLex.

**Contenuto:**
- **Backend (Express + TypeScript + Prisma)**: Routes, Controllers, Middleware, Database schema
- **Frontend (React 19 + TypeScript + Tailwind)**: Routing, State (Zustand), Services, Hooks, Components
- **Componenti per feature**: Workspace, Search, Expert Q&A, Contribution, Profile, Bookmarks, Dossiers, Bulletin Board
- **Integrazione MERL-T**: Proxy layer, flussi completi, authority calculation

**Usa quando:**
- Devi capire l'architettura frontend/backend
- Cerchi un componente UI specifico
- Vuoi estendere una feature esistente
- Debug di un endpoint API

---

### 4. [VISUALEX_IMPLEMENTATION_STATUS.md](../../VisuaLexAPI/docs/VISUALEX_IMPLEMENTATION_STATUS.md)
**Stato implementativo feature-by-feature** della piattaforma.

**Contenuto:**
- **18 aree funzionali** documentate: Auth, Search, Workspace, Expert Q&A, Bookmarks, Dossiers, etc.
- **Per ogni feature**: Status, Backend endpoints, Frontend components, Database tables, Integration points
- **Issues prioritari**: Loop infinito useAnnexNavigation, Tracking implicito, Mobile responsive, Test coverage
- **Roadmap Q1-Q3 2026**

**Usa quando:**
- Vuoi sapere cosa è implementato
- Pianifichi sprint
- Verifichi integrazioni MERL-T
- Identifichi bugs noti

---

## 📖 Integrazione MERL-T ↔ VisuaLex

### 5. [INTEGRATION_MERL_T_VISUALEX.md](./INTEGRATION_MERL_T_VISUALEX.md)
**Mappatura completa delle integrazioni** tra i due sistemi.

**Contenuto:**
- **Architecture overview**: Diagramma completo Frontend → Backend → MERL-T → Database
- **API integration points**: Tutti i 15+ endpoint MERL-T esposti a VisuaLex (Expert, Feedback, Auth, Enrichment, Profile)
- **Data flow per feature**: Expert Q&A Query, Feedback Submission, Authority Calculation, Live Enrichment (step by step)
- **Authentication & User sync**: Mapping merltUserId, authority calculation, token flow
- **Database integration**: Quali tabelle, sync mechanisms, data ownership
- **Environment variables**: Tutte le env vars necessarie
- **Known issues & limitations**: Performance, race conditions, TODOs
- **Future improvements**: WebSockets, GraphQL, batch queries

**Usa quando:**
- Debug problemi di integrazione
- Vuoi capire il flusso end-to-end di una feature
- Implementi nuove integrazioni
- Ottimizzi performance cross-system
- Troubleshooting errori di comunicazione

---

## 🗺️ Navigazione per Caso d'Uso

### 🔍 "Voglio implementare una nuova feature"

1. **Verifica se esiste già**:
   - MERL-T → [MERL_T_IMPLEMENTATION_STATUS.md](./MERL_T_IMPLEMENTATION_STATUS.md)
   - VisuaLex → [VISUALEX_IMPLEMENTATION_STATUS.md](../../VisuaLexAPI/docs/VISUALEX_IMPLEMENTATION_STATUS.md)

2. **Capisci l'architettura del modulo**:
   - MERL-T → [MERL_T_ARCHITECTURE_MAP.md](./MERL_T_ARCHITECTURE_MAP.md) sezione specifica
   - VisuaLex → [VISUALEX_ARCHITECTURE_MAP.md](../../VisuaLexAPI/docs/VISUALEX_ARCHITECTURE_MAP.md)

3. **Se richiede integrazione**:
   - [INTEGRATION_MERL_T_VISUALEX.md](./INTEGRATION_MERL_T_VISUALEX.md) per capire pattern esistenti

### 🐛 "Ho un bug da debuggare"

1. **Identifica il modulo**: Usa Architecture Map per capire dove si trova il codice
2. **Verifica known issues**: Controlla Implementation Status per bugs noti
3. **Se coinvolge integrazione**: [INTEGRATION_MERL_T_VISUALEX.md](./INTEGRATION_MERL_T_VISUALEX.md) per tracciare il flusso

### 📊 "Devo fare una presentazione/demo"

1. **Overview generale**: Architecture Map di entrambi i sistemi
2. **Feature completate**: Implementation Status dashboard
3. **Punti di integrazione**: Integration doc, sezione Architecture Overview

### 🎓 "Onboarding nuovo sviluppatore"

**Ordine di lettura consigliato:**
1. [MERL_T_ARCHITECTURE_MAP.md](./MERL_T_ARCHITECTURE_MAP.md) - Capire la libreria
2. [VISUALEX_ARCHITECTURE_MAP.md](../../VisuaLexAPI/docs/VISUALEX_ARCHITECTURE_MAP.md) - Capire la piattaforma
3. [INTEGRATION_MERL_T_VISUALEX.md](./INTEGRATION_MERL_T_VISUALEX.md) - Come comunicano
4. Implementation Status docs - Feature coverage

### 🚀 "Pianificazione sprint/roadmap"

1. **Cosa manca**: Implementation Status docs (❌ Not Started, 🚧 In Progress)
2. **Known issues prioritari**: Sezioni "Known Issues" in ogni doc
3. **Future improvements**: Roadmap Q1-Q3 in VisuaLex Implementation Status

---

## 📂 Struttura Cartelle Documentazione

```
MERL-T_alpha/docs/
├── README_DOCUMENTATION.md           ← Questo file (guida navigazione)
├── MERL_T_ARCHITECTURE_MAP.md        ← Architettura MERL-T
├── MERL_T_IMPLEMENTATION_STATUS.md   ← Status feature MERL-T
├── INTEGRATION_MERL_T_VISUALEX.md    ← Integrazioni tra i sistemi
├── backup_2026-01-04/                ← Backup docs precedenti
├── claude-context/                   ← Context per AI agents
│   ├── LIBRARY_VISION.md
│   ├── CURRENT_STATE.md
│   └── PROGRESS_LOG.md
└── archive/                          ← Docs obsoleti (legacy)

VisuaLexAPI/docs/
├── VISUALEX_ARCHITECTURE_MAP.md      ← Architettura VisuaLex
├── VISUALEX_IMPLEMENTATION_STATUS.md ← Status feature VisuaLex
├── backend/                          ← Docs backend-specific
└── frontend/                         ← Docs frontend-specific
```

---

## 🔄 Mantenimento Documentazione

### Quando Aggiornare

**Architecture Map:**
- ✅ Aggiunto nuovo modulo/cartella
- ✅ Refactored architettura di un componente
- ✅ Cambiate dipendenze tra moduli

**Implementation Status:**
- ✅ Feature completata/iniziata
- ✅ Test coverage cambiato significativamente
- ✅ Nuovo known issue critico
- ✅ Database schema modificato

**Integration Doc:**
- ✅ Nuovo endpoint MERL-T esposto
- ✅ Modificato flusso di integrazione
- ✅ Nuova env var richiesta
- ✅ Fix a known issue di integrazione

### Come Aggiornare

1. **Usa agenti specializzati** (consigliato):
   ```
   > Usa scribe per aggiornare MERL_T_IMPLEMENTATION_STATUS.md
     aggiungendo la feature X completata
   ```

2. **Manuale**:
   - Mantieni lo stesso formato
   - Aggiorna data "Last Updated"
   - Aggiungi note in sezione appropriata

---

## 🎯 Metriche Chiave (Snapshot 4 Gen 2026)

### MERL-T
- **Completezza**: 94.3% (66/70 feature)
- **Test Coverage**: 76% (311+ test)
- **LOC**: ~15,000 linee Python
- **Database**: 27,740 nodi, 43,935 relazioni, 5,926 vectors

### VisuaLex
- **Feature Implementate**: 18 aree funzionali, ~85% complete
- **Test Coverage**: <20% (da migliorare)
- **LOC Backend**: ~8,000 linee TypeScript
- **LOC Frontend**: ~12,000 linee TypeScript/TSX

### Integrazione
- **API Endpoints**: 15+ MERL-T endpoint esposti
- **Data Sync**: Real-time authority, async feedback tracking
- **Performance**: 2-5s per expert query (accettabile)

---

## 🆘 Troubleshooting Documentazione

**"Non trovo dove si trova il codice per X"**
→ Cerca in Architecture Map, sezione componenti chiave

**"Non so se la feature Y è implementata"**
→ Controlla Implementation Status, cerca per nome feature

**"Debug: il flusso si interrompe tra VisuaLex e MERL-T"**
→ Integration doc, sezione Data Flow per la feature specifica

**"Quali test devo scrivere per il modulo Z?"**
→ Implementation Status, colonna Test Coverage per vedere pattern esistenti

**"La documentazione è obsoleta/manca qualcosa"**
→ Apri issue o usa agente `scribe` per update

---

## 📞 Contatti & Contributi

**Maintainer**: Giuseppe Puzio (Tesi Sociologia Computazionale del Diritto)

**Per aggiornamenti**:
- Usa agente `scribe` per docs professionali
- Mantieni formato esistente
- Aggiungi date e changelog

**Repository**:
- MERL-T: `../MERL-T_alpha`
- VisuaLex: `.`

---

*Questa documentazione è stata generata con rigore da agenti AI specializzati, leggendo effettivamente i file della codebase. Non è generica, ma riflette lo stato reale del progetto al 4 Gennaio 2026.*

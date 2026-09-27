# MERL-T Documentation

> Documentazione per la libreria `merlt` - informatica giuridica italiana

---

## Struttura

```
docs/
├── claude-context/     # 🤖 Per Claude Code (sessioni di sviluppo)
│   ├── LIBRARY_VISION.md       # Principi guida della libreria
│   ├── LIBRARY_ARCHITECTURE.md # Architettura componenti
│   ├── CURRENT_STATE.md        # Stato attuale
│   └── PROGRESS_LOG.md         # Log cronologico
│
├── experiments/        # 🧪 Esperimenti per tesi
│   ├── INDEX.md               # Indice esperimenti
│   └── EXP-NNN_*/             # Singoli esperimenti
│
├── architecture/       # 🏗️ Architettura sistema
│   ├── overview.md            # Vista d'insieme
│   ├── storage-layer.md       # FalkorDB, Qdrant, Bridge Table
│   ├── pipeline.md            # Ingestion, Multivigenza
│   └── retrieval.md           # Ricerca ibrida
│
├── api/               # 📚 API Reference
│   └── (da generare con sphinx/pdoc)
│
├── guides/            # 📖 Guide utente
│   ├── quickstart.md          # Getting started
│   ├── ingestion.md           # Come fare ingestion
│   └── search.md              # Come cercare
│
├── rlcf/              # 📄 Paper RLCF (per tesi)
│   └── RLCF.md                # Framework teorico
│
└── archive/           # 📦 Documenti archiviati
    └── (vecchi docs non più rilevanti)
```

---

## Quick Links

| Documento | Scopo |
|-----------|-------|
| [LIBRARY_VISION.md](claude-context/LIBRARY_VISION.md) | Principi guida libreria |
| [CURRENT_STATE.md](claude-context/CURRENT_STATE.md) | Stato attuale sviluppo |
| [experiments/INDEX.md](experiments/INDEX.md) | Indice esperimenti tesi |

---

## Per Contribuire

1. Leggi `claude-context/LIBRARY_VISION.md`
2. Segui le convenzioni in `CLAUDE.md` (root del progetto)
3. Documenta in italiano, codice in inglese

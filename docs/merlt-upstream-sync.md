# MERL-T Upstream Sync Policy

**Created:** 2026-05-22 (Story MERLT-1.0)
**Status:** Active policy

---

## Single source of truth

Da questo momento, **`VisuaLexAPI/merlt/`** è la single source of truth per il codice MERL-T usato in produzione VisuaLex.

`/Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/` resta come **reference read-only**: storico di sviluppo, snapshot completo (incluso `data/` 317 MB, `models/`, `examples/`, ecc.).

**Baseline import**: tag git `merlt-baseline-from-alis-core` segna il commit di prima copia. Riferimento per audit/regression.

---

## Cosa è stato copiato

`VisuaLexAPI/merlt/` (~5.5 MB, 328 file) contiene tutto il codice Python necessario al runtime:

```
merlt/
├── merlt/              codice Python (api/, app.py, experts/, rlcf/, storage/, ner/, pipeline/, ...)
├── alembic/            DB migrations
├── alembic.ini         Alembic config
├── scripts/            utility scripts
├── config/             config YAML (experts, prompts, etc.)
├── Dockerfile          multi-stage build
├── pyproject.toml      Python deps
├── docker-compose.dev.yml  (compose interno MERL-T, NON usato dal nostro start.sh)
├── api-contract.json   OpenAPI schema (235 KB)
├── docs/               docs MERL-T (architecture/, api/, rlcf/, thesis/, claude-context/, guides/, plans/)
├── README.md, CLAUDE.md, LICENSE
├── bandit.yaml, .gitignore, .dockerignore
├── src/                placeholder vuoto
├── uploads/            runtime dir (uploads/user_documents/)
└── start_dev.sh        script MERL-T standalone (NON usato dal nostro start.sh)
```

## Cosa NON è stato copiato (e perché)

| Path | Size | Motivo esclusione |
|------|------|-------------------|
| `data/` | 317 MB | Knowledge graph + embeddings — ricostruibili, non source code |
| `.venv/` | ~100 MB | Virtual environment — ricreabile via `pip install` |
| `models/` | 32 KB | Contiene `legal_ner_checkpoints/` (NER weights) — ricreabile via training |
| `tests/` | 20 MB | Test pesanti MERL-T standalone — non eseguiti nel flusso VisuaLex Slice 1 |
| `examples/` | 964 KB | Script di sviluppo/test one-off |
| `exports/` | 992 KB | Artifact di export precedenti |
| `docs/experiments/` | 29 MB | Notebooks + risultati esperimenti — reference solo in ALIS_CORE |
| `docs/archive/` | 4.7 MB | Doc archiviati |
| `docs/backup_*/` | 144 KB | Backup precedenti |
| `merlt.egg-info/` | 28 KB | Egg metadata — rigenerabile via `pip install -e .` |
| `.pytest_cache/`, `.ruff_cache/`, `.benchmarks/` | misc | Cache, rigenerabili |
| `__pycache__/`, `*.pyc` | misc | Bytecode Python |
| `.env` | — | Mai committare secrets |
| `frontend-audit.json`, `norma.log`, `trace_output.json` | misc | File runtime/audit one-off |

**Strategia globale**: portiamo codice + config + docs essenziali + API contract. Tutto il resto (dati, modelli, cache, virtual env) si ricostruisce localmente con setup standard.

---

## Procedura di sync con upstream ALIS_CORE

**Quando**: solo se ALIS_CORE/merlt riceve fix critici (bug, security) che vogliamo portare in VisuaLex. Le evoluzioni feature di MERL-T (es. nuovi expert, NER models) restano in VisuaLex come fork dal momento dell'import.

**Procedura**:

1. Dal repo VisuaLexAPI, branch dedicato:
   ```bash
   git checkout -b merlt-upstream-sync-YYYY-MM-DD
   ```

2. Rsync selettivo (stesse esclusioni dell'import originale):
   ```bash
   rsync -a --dry-run \
     --exclude='data/' \
     --exclude='.venv/' \
     --exclude='models/' \
     --exclude='tests/' \
     --exclude='examples/' \
     --exclude='exports/' \
     --exclude='docs/experiments/' \
     --exclude='docs/archive/' \
     --exclude='docs/backup_*/' \
     --exclude='merlt.egg-info/' \
     --exclude='.pytest_cache/' \
     --exclude='.ruff_cache/' \
     --exclude='.benchmarks/' \
     --exclude='__pycache__/' \
     --exclude='*.pyc' \
     --exclude='.env' \
     --exclude='.DS_Store' \
     --exclude='*.log' \
     --exclude='trace_output.json' \
     --exclude='frontend-audit.json' \
     --exclude='.claude-doc-trigger.json' \
     /Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/ \
     ./merlt/
   ```
   (rimuovi `--dry-run` per applicare)

3. Review del diff:
   ```bash
   git diff --stat merlt/
   git diff merlt/ | less
   ```

4. Se ci sono modifiche locali in VisuaLex che vanno PRESERVATE (es. fix specifici al BFF integration), risolvere manualmente.

5. Commit + PR verso `visualex-merlt-main` (NON main):
   ```bash
   git commit -m "chore(merlt): sync from upstream ALIS_CORE YYYY-MM-DD"
   ```

6. Smoke E2E manuale + test suite verde prima di merge.

7. Aggiornare il tag baseline se è un import "major":
   ```bash
   git tag -a merlt-baseline-from-alis-core-vN -m "Major sync from ALIS_CORE YYYY-MM-DD"
   ```

---

## Anti-drift safeguards

1. **`docs/merlt-upstream-sync.md`** (questo doc) — leggere prima di qualsiasi modifica strutturale a `merlt/`.
2. **Tag baseline** `merlt-baseline-from-alis-core` — riferimento per audit (`git diff merlt-baseline-from-alis-core -- merlt/`).
3. **CODEOWNERS** (futuro, opzionale): assegnare review obbligatorio per modifiche a `merlt/`.

---

## Note

- Il `docker-compose.dev.yml` interno a `merlt/` è MERL-T standalone (per dev MERL-T isolato). Il nostro flusso VisuaLex usa **`docker-compose.merlt.yml` nella root del repo** (4 servizi sidecar + merlt-api opzionale via profile).
- `start_dev.sh` interno a `merlt/` analogamente NON viene usato — il nostro `start.sh` root invoca uvicorn direttamente.
- Se `ALIS_CORE/merlt` viene cancellato/spostato, NULLA cambia in VisuaLex: `merlt/` è autocontenuto. Per ricostruire `data/` serve documentazione separata (riferirsi a `merlt/docs/`).

# datakit — portable data

Data moves by export and import, never by copying a database's files.

```bash
scripts/backup.sh                          # ~/visualex-backups/visualex-<UTC time>/
scripts/restore.sh ~/visualex-backups/X    # into the stack of infra/.env; refuses non-empty stores
scripts/restore.sh X --force               # replace what is there
python3 scripts/datakit/cli.py verify X    # files intact? live counts equal?
```

A folder holds `postgres/<db>.dump` (`pg_dump -Fc`), `falkordb/dump.rdb`,
`qdrant/<collection>.snapshot`, `volumes/<volume>.tgz` and `manifest.json`
(time, commit, image versions, each database's migration level, a sha256 per
file, the counts of every store). The folder is readable by its owner only.

The stack name and ports come from the shell, then `infra/.env`, then the
defaults — the same order Compose uses. Restore with only the stores running
(`docker compose -f infra/compose.yml up -d --wait postgres falkordb qdrant`):
the MERL-T api and worker write to them. Every store is checked before any is
written; a database whose tables are empty (as `start.sh` leaves it after
migrating) counts as empty, and each database loads in one transaction.
Redis (cache and queues) and the model download cache are not saved.

`--stack NAME` works on another stack; `--pg-container`, `--falkor-container`,
`--qdrant-url`, `--volume-prefix`, `--databases`, `--volumes` point at stores by
name, which is how a stack that does not follow `infra/compose.yml` is exported.

Backups contain personal data (accounts, notes, uploads): keep them outside the
repository, encrypted when they leave the machine.

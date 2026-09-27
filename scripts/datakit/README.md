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
(time, commit, image versions, a sha256 per file, the counts of every store).
Redis (cache and queues) and the model download cache are not saved.

`--stack NAME` works on another stack; `--pg-container`, `--falkor-container`,
`--qdrant-url`, `--volume-prefix`, `--databases`, `--volumes` point at stores by
name, which is how a stack that does not follow `infra/compose.yml` is exported.

Backups contain personal data (accounts, notes, uploads): keep them outside the
repository, encrypted when they leave the machine.

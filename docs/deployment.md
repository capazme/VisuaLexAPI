# Running VisuaLex on the deployment host

The runbook for the production stack (`./start.sh --prod`) on a Linux machine.
The design behind it: `docs/superpowers/specs/2026-09-29-modular-deployment-design.md`
(the stack) and `docs/superpowers/specs/2026-10-05-mcp-production-design.md` (the MCP
server). Commands run in the checkout on the host unless they say otherwise. Never run
`./start.sh --dev` on this machine: both modes share the stack name and its volumes.

## 1. Preparing the host (once)

- **Docker Engine** 28 or newer, with the **Compose v2 plugin**, 2.24 or newer.
  - Check with `docker version` and `docker compose version`.
  - A distribution's Docker package may lack the plugin; install `docker-compose-plugin`
    from Docker's repository.
  - On an Engine older than 28 with `userland-proxy: false`, other devices on the network
    could reach ports published on `127.0.0.1`: upgrade first.
- **The deploying user in the `docker` group:** `sudo usermod -aG docker <user>`, then log
  in again.
- **`git`, `python3`** (the backup tool), **`curl`**.
- **Docker enabled at boot:** `sudo systemctl enable docker`.
- **A free port for the ingress.** The default is 8080. If another program on the machine
  holds it, set `INGRESS_PORT` in `infra/.env`, e.g. 8090. The deploy checks the ports
  before it builds and names the key to change.

## 2. The first deploy

```sh
git clone <repository> && cd VisuaLexAPI
./start.sh --prod --branch develop      # or main, once a release carries --prod
```

What happens:
1. **The checkout** is fast-forwarded to origin's branch.
2. **`infra/.env` and `apps/server/.env`** are created with generated secrets, mode 600.
   The first admin's password is `ADMIN_PASSWORD` in `apps/server/.env`. Sign in, change
   it, delete that line, and deploy again.
3. **The preflight** refuses development values. Env files left by an old `--dev` run on
   this machine are refused: move them aside (`mv infra/.env infra/.env.dev-old`, the
   same for `apps/server/.env`) and run again, so new ones are generated.
4. **The build** runs, the migrations are applied, and every module must report healthy.
   The first build takes several minutes.

**Not generated, to copy in by hand:** `OPENROUTER_API_KEY` in `infra/.env`, the key of
MERL-T's experts. The preflight warns while it is empty.

## 3. Serving it on the private network (Tailscale)

The stack publishes only on the host's loopback. The overlay network's HTTPS proxy
publishes it:

1. **The tailnet's administrator enables HTTPS certificates** for the tailnet, in the
   Tailscale admin console.
2. **In `infra/.env`**, `PUBLIC_ORIGIN=https://<host>.ts.net`. This is one origin, with no
   trailing slash: it is the OAuth issuer.
3. **The app:** `tailscale serve --bg http://127.0.0.1:<INGRESS_PORT>`.
4. **Deploy again** so the server and the app take the origin:
   `./start.sh --prod --branch develop`.

**The MCP server, for Claude Code** (optional):
1. In `infra/.env`, `MCP_PUBLIC_URL=https://<host>.ts.net:8443/mcp`. It must be the same
   host as `PUBLIC_ORIGIN` and end in `/mcp`.
2. Deploy again. The deploy generates `MCP_CLIENT_SECRET` and `OAUTH_DELEGATION_SECRET`,
   starts the `mcp` module on `127.0.0.1:8091` (`MCP_PORT`), and prints the line to give
   people.
3. `tailscale serve --bg --https=8443 http://127.0.0.1:8091`.
4. On another device of the tailnet:
   `claude mcp add --transport http visualex https://<host>.ts.net:8443/mcp`, then sign in
   with a VisuaLex account.

**Check once that a client cannot forge its address.** The login limit counts each
device at its own address. From another device, send six logins with a wrong password
and an invented address. Then send a seventh with another invented address. The seventh
must be refused too (429):

```sh
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.9' -d '{"email":"prova@example.invalid","password":"sbagliata"}' https://<host>.ts.net/api/auth/login; done
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.10' -d '{"email":"prova@example.invalid","password":"sbagliata"}' https://<host>.ts.net/api/auth/login
```

If the last one is 401, the proxy passed the header through: delete the
`trusted_proxies` line in `infra/ingress/Caddyfile` and deploy again. That device's
logins stay blocked for 15 minutes after the check.

## 4. Updating, and going back

- **Update:** `./start.sh --prod --branch develop` (or `main`). A backup of the running
  stack is taken first, then the new version is built, migrated and started.
- **Going back to an older version.** Migrations do not walk backwards, so the way back
  for the data is the backup taken before the update:
  1. Check out the older version (`git switch --detach <tag or commit>`).
  2. Deploy it with `./start.sh --prod --no-pull --allow-branch`.
  3. If its schema is older than the data, restore the backup taken before the update
     (section 5).

  `--branch` refuses to move to a version that lacks a migration the checkout already
  has; with `--no-pull` that check is yours.
- **Stop:** `./start.sh --prod --stop`. The containers and volumes stay.

## 5. Backups

- **Before each deploy of an existing stack** (not the first; `--no-backup` skips it),
  automatically, into `~/visualex-backups/<stack>-<UTC time>/`
  (folders readable by their owner only).
- **Daily**, once it is switched on:

  ```sh
  sh scripts/prod/backup-timer.sh install    # daily at 03:30; the newest 7 folders are kept
  sudo loginctl enable-linger <user>         # once: the timer runs while nobody is logged in
  sh scripts/prod/backup-timer.sh status     # next run, newest backup
  sh scripts/prod/backup-timer.sh remove     # stop it (the backups stay)
  ```

  The seven kept are the newest complete backups of the stack, whoever took them: the
  deploys' backups count too. A folder left half-written by a failure is removed once a
  newer complete backup exists. The user must already be in the `docker` group when the
  timer starts; if it was added later, log out and in again (or reboot) first. `BACKUP_KEEP` changes the number for a manual run of
  `scripts/prod/backup-daily.sh`.
- **Restore:** `scripts/restore.sh ~/visualex-backups/<folder>` into the stack of
  `infra/.env`, with only the stores running. Read `scripts/datakit/README.md` first. A
  restore is rehearsed once on a throwaway stack before it is needed.
- **Off the machine.** The backups hold personal data and stay on this disk for now. A
  copy elsewhere (encrypted) is a later step of the deployment design (section 8).

## 6. When a module is unhealthy

- **What runs, and its state:** `docker compose -f infra/compose.yml -f infra/compose.app.yml
  -f infra/compose.scrapers.yml -f infra/compose.prod.yml ps`. The deploy prints the exact
  file list, profiles included.
- **The logs of one module:** the same command with `logs <module>`.
- **Postgres unhealthy on a first start:** it has a minute's margin. If the host is still
  building, run the deploy again.
- **The scrapers killed:** Chromium was over its memory ceiling (`SCRAPERS_MEM_LIMIT`,
  default 2g).
- **The MCP answers 503 to every call:** it cannot reach the server for introspection.
  Check that `server` is healthy.
- **The MCP answers 401 to a signed-in client:** `MCP_PUBLIC_URL` differs from what the
  client typed. The address must be the same, character for character, and the client
  must sign in again after it changes.

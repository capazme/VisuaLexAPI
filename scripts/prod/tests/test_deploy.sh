#!/bin/sh
# What ./start.sh --prod runs (scripts/prod/*.sh), and start.sh itself: its flags, the hand-over
# to --prod, and the first run of --dev.
# Every scenario is a throwaway git repository laid out like the real one, with stubs
# (`docker`, and for --dev `python3.14`, `npm`, `lsof`) that record their calls: nothing
# real is built, installed, started or backed up.
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1"; fail=1; }
show() { sed 's/^/     /' "$1" | head -8; }

# --- a throwaway repository ---------------------------------------------------------
mkrepo() { # mkrepo <name>: prints its path
  d="$work/$1"
  mkdir -p "$d/scripts/prod" "$d/infra" "$d/apps/server" "$d/vendor/mcp-legal-it" "$d/bin"
  cp "$here"/lib.sh "$here"/preflight.sh "$here"/init-env.sh "$here"/deploy.sh "$d/scripts/prod/"
  cp "$root/infra/.env.example" "$d/infra/.env.example"
  cp "$root/apps/server/.env.example" "$d/apps/server/.env.example"
  for f in compose.yml compose.app.yml compose.scrapers.yml compose.prod.yml; do : >"$d/infra/$f"; done
  : >"$d/vendor/mcp-legal-it/Dockerfile"
  echo readme >"$d/README.md"
  printf '.env\n.env.*\n!.env.example\nbin/\n*.log\nvolume-exists\n' >"$d/.gitignore"
  # the backup tool, as a stub: it says it ran, in the same log as docker, and can fail
  cat >"$d/scripts/backup.sh" <<'EOF'
#!/bin/sh
echo "BACKUP $*" >>"$STUB_LOG"
exit "${BACKUP_EXIT:-0}"
EOF
  # docker, as a stub: records the call, answers just enough
  cat >"$d/bin/docker" <<'EOF'
#!/bin/sh
echo "docker $*" >>"$STUB_LOG"
case "$1 $2" in
  "info "*)          exit "${STUB_INFO_EXIT:-0}" ;;
  "compose version") echo "${STUB_COMPOSE_VERSION:-2.39.4}"; exit 0 ;;
  "volume ls")       [ -e "$STUB_VOLUME" ] && cat "$STUB_VOLUME"; exit "${STUB_VOLUME_LS_EXIT:-0}" ;; # the file holds the names
esac
case "$*" in *--no-recreate*) exit "${STUB_STORES_EXIT:-0}" ;; esac # the start of the stores before a backup
exit "${STUB_DOCKER_EXIT:-0}"
EOF
  chmod +x "$d/bin/docker" "$d/scripts/backup.sh"
  git -C "$d" init -q -b main
  git -C "$d" add -A
  git -C "$d" -c user.name=t -c user.email=t@example.invalid commit -q -m base
  : >"$d/docker.log"
  echo "$d"
}

# run <repo> <script args...>: the script from the repo, with the stub first on PATH.
# EXTRA_ENV (set and unset around one call) adds variables for that call only: an
# assignment in front of a function call outlives the call in some shells (dash).
EXTRA_ENV=""
run() {
  d="$1"; shift
  # shellcheck disable=SC2086
  ( cd "$d" && env PATH="$d/bin:$PATH" STUB_LOG="$d/docker.log" STUB_VOLUME="$d/volume-exists" $EXTRA_ENV sh "$@" )
}
# outcome <repo> <script args...>: sets $status and leaves the output in $work/out
outcome() {
  if run "$@" >"$work/out" 2>&1; then status=0; else status=$?; fi
}
expect_status() { # expect_status <0|nonzero> <description>
  if [ "$1" = 0 ] && [ "$status" = 0 ]; then ok "$2"
  elif [ "$1" = nonzero ] && [ "$status" != 0 ]; then ok "$2"
  else bad "$2 (exit $status)"; show "$work/out"; fi
}
expect_out() { # expect_out <text> <description>
  if grep -qF -- "$1" "$work/out"; then ok "$2"; else bad "$2 (no '$1' in the output)"; show "$work/out"; fi
}
expect_log() { # expect_log <repo> <text> <description>
  if grep -qF -- "$2" "$1/docker.log"; then ok "$3"; else bad "$3 (no '$2' in the docker log)"; show "$1/docker.log"; fi
}
expect_no_log() { # expect_no_log <repo> <text> <description>
  if grep -qF -- "$2" "$1/docker.log"; then bad "$3 ('$2' is in the docker log)"; show "$1/docker.log"; else ok "$3"; fi
}
expect_no_out() { # expect_no_out <text> <description>: what a script printed (stdout and stderr), not what docker was asked
  if grep -qF -- "$1" "$work/out"; then bad "$2 ('$1' is in the output)"; show "$work/out"; else ok "$2"; fi
}
expect_log_re() { # expect_log_re <repo> <regex> <description>
  if grep -qE -- "$2" "$1/docker.log"; then ok "$3"; else bad "$3 (nothing matches '$2' in the log)"; show "$1/docker.log"; fi
}
line_of() { grep -n -- "$2" "$1/docker.log" | head -1 | cut -d: -f1; } # line_of <repo> <text>: the first line that has it
mode_of() { ls -ld "$1" | cut -c1-10; }

# --- the host checks -----------------------------------------------------------------
d="$(mkrepo dirty)"
echo change >>"$d/README.md"
outcome "$d" scripts/prod/preflight.sh host
expect_status nonzero "a working tree with uncommitted changes is refused"
expect_out "uncommitted" "and says why"

d="$(mkrepo branch)"
git -C "$d" switch -q -c feat/x
outcome "$d" scripts/prod/preflight.sh host
expect_status nonzero "a branch that is neither main nor a release tag is refused"
outcome "$d" scripts/prod/preflight.sh host --allow-branch
expect_status 0 "and accepted with --allow-branch"

d="$(mkrepo tag)"
git -C "$d" tag v1.2.3
git -C "$d" checkout -q --detach v1.2.3
outcome "$d" scripts/prod/preflight.sh host
expect_status 0 "a vX.Y.Z tag is accepted"
expect_out "v1.2.3" "and the tag being deployed is printed"

d="$(mkrepo main)"
outcome "$d" scripts/prod/preflight.sh host
expect_status 0 "main with a clean tree is accepted"
expect_out "$(git -C "$d" rev-parse --short HEAD)" "and the commit being deployed is printed"

d="$(mkrepo oldcompose)"
EXTRA_ENV="STUB_COMPOSE_VERSION=2.20.0"; outcome "$d" scripts/prod/preflight.sh host; EXTRA_ENV=""
expect_status nonzero "a Compose older than 2.24 is refused"
expect_out "2.24" "and the required version is named"

# --- the env files ----------------------------------------------------------------------
d="$(mkrepo devenv)"
cp "$d/infra/.env.example" "$d/infra/.env"
cp "$d/apps/server/.env.example" "$d/apps/server/.env"
outcome "$d" scripts/prod/preflight.sh env
expect_status nonzero "env files that still hold the development values are refused"
expect_out "POSTGRES_PASSWORD" "naming the database password"
expect_out "JWT_SECRET" "and the JWT secret"

d="$(mkrepo firstrun)"
outcome "$d" scripts/prod/init-env.sh
expect_status 0 "the first run creates the env files"
expect_out "infra/.env" "and says where the stack's is"
expect_out "apps/server/.env" "and where the server's is"
[ -f "$d/infra/.env" ] && [ -f "$d/apps/server/.env" ] && ok "both exist" || bad "both exist"
[ "$(mode_of "$d/infra/.env")" = "-rw-------" ] && [ "$(mode_of "$d/apps/server/.env")" = "-rw-------" ] \
  && ok "and are readable by their owner only" || bad "and are readable by their owner only ($(mode_of "$d/infra/.env"))"
leak=0
for pair in "infra/.env POSTGRES_PASSWORD" "infra/.env PLATFORM_DB_PASSWORD" "infra/.env MERLT_DB_PASSWORD" \
            "infra/.env MERLT_INTERNAL_SECRET" "infra/.env MERLT_API_KEY" "apps/server/.env JWT_SECRET" "apps/server/.env ADMIN_PASSWORD"; do
  set -- $pair
  value="$(sed -n "s/^$2=//p" "$d/$1" | tail -1 | sed 's/^"\(.*\)"$/\1/')"
  if [ "${#value}" -lt 24 ]; then bad "$2 is generated and long enough (got ${#value} characters)"; leak=1; continue; fi
  if grep -qF -- "$value" "$work/out"; then bad "$2's value is not printed"; leak=1; fi
done
[ "$leak" = 0 ] && ok "every secret is generated, long, and not printed"
grep -q '^MERLT_ENABLED=true' "$d/infra/.env" && ok "MERL-T is on from the first run" || bad "MERL-T is on from the first run"
outcome "$d" scripts/prod/preflight.sh env
expect_status 0 "the generated files pass the check"
sum1="$(cksum "$d/infra/.env" "$d/apps/server/.env" | tr '\n' ' ')"
outcome "$d" scripts/prod/init-env.sh
sum2="$(cksum "$d/infra/.env" "$d/apps/server/.env" | tr '\n' ' ')"
[ "$sum1" = "$sum2" ] && ok "a second run never overwrites what exists" || bad "a second run never overwrites what exists"

# --- the deploy ---------------------------------------------------------------------------
d="$(mkrepo first)"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a first deploy on main runs to the end"
expect_log "$d" "docker compose -f infra/compose.yml -f infra/compose.app.yml -f infra/compose.scrapers.yml -f infra/compose.prod.yml --profile merlt up -d --build --wait" \
  "it builds and starts the four files in order, MERL-T included, and waits"
expect_no_log "$d" "BACKUP" "and takes no backup: there is nothing to back up yet"
expect_log "$d" "exec -T server node dist/utils/seed.js" "and seeds the admin (the seed is idempotent)"
expect_out "$(git -C "$d" rev-parse --short HEAD)" "and reports the commit it deployed"
# `.Health` has no column header in Compose's table format (the header reads "<no value>").
expect_log "$d" 'ps --format table {{.Service}}' "and lists every module ..."
expect_log "$d" '{{.Status}}' "... with its status (Up ... (healthy))"
expect_no_log "$d" ".Health" "in a format whose column headers Compose knows"
if grep -qF -- "$(sed -n 's/^JWT_SECRET=//p' "$d/apps/server/.env" | tr -d '"')" "$work/out"; then bad "no secret in the report"; else ok "and no secret in the report"; fi
expect_no_out "other Postgres volumes" "and, on a host with no other Postgres volume, no warning about one"

a="$(grep -n 'deploying' "$work/out" | head -1 | cut -d: -f1)"; b="$(grep -n 'building and starting' "$work/out" | head -1 | cut -d: -f1)"
if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then ok "the commit being deployed is printed before the build, not only after it"; else bad "the commit being deployed is printed before the build (line $a, the build starts at $b)"; show "$work/out"; fi

d="$(mkrepo again)"
run "$d" scripts/prod/deploy.sh >/dev/null 2>&1
: >"$d/docker.log"; echo visualex_postgres_data >"$d/volume-exists"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a deploy over an existing stack runs to the end"
expect_log "$d" "up -d --wait --no-recreate postgres redis falkordb qdrant" "it starts the stores that are down, and recreates none, as a backup needs them"
expect_log "$d" "BACKUP" "and takes a backup"
stores_line="$(grep -n 'up -d --wait --no-recreate postgres' "$d/docker.log" | head -1 | cut -d: -f1)"
backup_line="$(grep -n 'BACKUP' "$d/docker.log" | head -1 | cut -d: -f1)"
build_line="$(grep -n -- '--build' "$d/docker.log" | head -1 | cut -d: -f1)"
[ "$stores_line" -lt "$backup_line" ] && [ "$backup_line" -lt "$build_line" ] \
  && ok "in that order: stores, backup, then the build" || bad "in that order: stores ($stores_line), backup ($backup_line), build ($build_line)"

: >"$d/docker.log"
outcome "$d" scripts/prod/deploy.sh --no-backup
expect_status 0 "--no-backup deploys"
expect_no_log "$d" "BACKUP" "and takes no backup"

: >"$d/docker.log"
EXTRA_ENV="BACKUP_EXIT=1"; outcome "$d" scripts/prod/deploy.sh; EXTRA_ENV=""
expect_status nonzero "a failing backup stops the deploy"
expect_no_log "$d" "--build" "before anything is built"
expect_out "backup" "and says so"
expect_out "nothing was built or migrated" "and says what was not done, and not that nothing was changed"

# The backup is decided on Docker's own answer: an error is never read as "no stack".
d="$(mkrepo volfail)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
: >"$d/docker.log"
EXTRA_ENV="STUB_VOLUME_LS_EXIT=1"; outcome "$d" scripts/prod/deploy.sh; EXTRA_ENV=""
expect_status nonzero "when Docker cannot list its volumes, the deploy stops"
expect_out "cannot list the Docker volumes" "and says so"
expect_no_log "$d" "--build" "before anything is built"
expect_no_log "$d" "BACKUP" "and takes no backup either"

d="$(mkrepo storesfail)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
: >"$d/docker.log"; echo visualex_postgres_data >"$d/volume-exists"
EXTRA_ENV="STUB_STORES_EXIT=1"; outcome "$d" scripts/prod/deploy.sh; EXTRA_ENV=""
expect_status nonzero "when the data stores do not come up healthy, the deploy stops"
expect_out "data stores did not come up healthy" "and says so, and that no backup could be taken"
expect_no_log "$d" "BACKUP" "with no backup attempted"
expect_no_log "$d" "--build" "and nothing built"

# A first deploy on a host that already holds another Postgres volume says so.
d="$(mkrepo otherstack)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
printf 'other_postgres_data\nunrelated_cache\n' >"$d/volume-exists"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a deploy that finds only another stack's Postgres volume goes on as a first deploy"
expect_out "a first deploy: nothing to back up yet" "and calls it one"
expect_out "other_postgres_data" "and names the other volume, once, in a warning"
expect_no_out "unrelated_cache" "and not the volumes that are not Postgres's"

# The stack's name is read as Compose reads it (an `export` line, CRLF line endings).
d="$(mkrepo exportstack)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
printf 'export VISUALEX_STACK=prod\r\n' >>"$d/infra/.env"
: >"$d/docker.log"; echo prod_postgres_data >"$d/volume-exists"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a stack named on an 'export' line with CRLF endings is deployed"
expect_log "$d" "BACKUP" "and its data is backed up, not taken for a first deploy"

# ... and with a comment after the value.
d="$(mkrepo commentstack)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
printf 'VISUALEX_STACK=prod # the stack\nMERLT_ENABLED=false # off for now\n' >>"$d/infra/.env"
: >"$d/docker.log"; echo prod_postgres_data >"$d/volume-exists"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a stack name and a MERL-T switch that carry comments are deployed"
expect_log "$d" "BACKUP" "the stack is found before its comment, so its data is backed up"
expect_no_log "$d" "--profile merlt" "and MERLT_ENABLED=false before a comment turns MERL-T off"

# The env files, read as Compose reads them.
. "$here/lib.sh"
f="$work/forms.env"
printf 'PLAIN=one\nPLAIN_X=zzz\nQUOTED="two"\nSINGLE='"'"'three'"'"'\nexport EXPORTED=four\nSPACED = five  \nCRLF=six\r\nDUP=a\nDUP=b\nEMPTY=\n' >"$f"
got="$(for k in PLAIN QUOTED SINGLE EXPORTED SPACED CRLF DUP MISSING EMPTY; do printf '[%s]' "$(env_get "$f" "$k")"; done)"
[ "$got" = "[one][two][three][four][five][six][b][][]" ] && ok "env_get reads plain, quoted, export, spaced, CRLF and repeated keys, and not a longer key or a missing one" \
  || bad "env_get reads the forms Compose reads (got $got)"
# Comments, as Compose reads them: after a bare value or after a quote, once a space comes before the `#`.
printf '%s\n' 'INLINE=visualex # the stack name' 'Q_INLINE="a" # note' "S_INLINE='b' # note" 'QUOTED_HASH="a # b"' \
  'HASH_IN_VALUE=ab#cd' '#COMMENTED=x' 'EMPTY_COMMENT= # off' 'FALSE_INLINE=false # off for now' 'INDENTED_COMMENT=  seven	# a tab before it' >"$f"
got="$(for k in INLINE Q_INLINE S_INLINE QUOTED_HASH HASH_IN_VALUE COMMENTED EMPTY_COMMENT FALSE_INLINE INDENTED_COMMENT; do printf '[%s]' "$(env_get "$f" "$k")"; done)"
[ "$got" = "[visualex][a][b][a # b][ab#cd][][][false][seven]" ] && ok "and comments after a value are dropped, a # inside quotes or glued to the value stays, a commented-out key is not found" \
  || bad "env_get and comments (got $got)"
[ -z "$(env_get "$work/no-such-file" PLAIN)" ] && ok "and a missing file gives nothing" || bad "and a missing file gives nothing"

d="$(mkrepo remote)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
printf 'SCRAPERS_ADDR=192.0.2.20:5000\n' >>"$d/infra/.env"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a deploy with the scrapers on another machine runs to the end"
expect_no_log "$d" "compose.scrapers.yml" "a remote SCRAPERS_ADDR leaves the scrapers file out"
expect_out "192.0.2.20:5000" "and says where they are expected"

d="$(mkrepo nomerlt)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
sed -i.bak 's/^MERLT_ENABLED=true/MERLT_ENABLED=false/' "$d/infra/.env" && rm -f "$d/infra/.env.bak"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a deploy with MERLT_ENABLED=false runs to the end"
expect_log "$d" "up -d --build --wait" "and builds the stack"
expect_no_log "$d" "--profile merlt" "with MERL-T left out"

d="$(mkrepo samehost)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
printf 'SCRAPERS_ADDR=scrapers:5001\n' >>"$d/infra/.env"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a deploy with SCRAPERS_ADDR on the scrapers container's own host runs to the end"
expect_log "$d" "compose.scrapers.yml" "and keeps the scrapers file in"
expect_no_out "elsewhere" "and prints no 'elsewhere' note"

d="$(mkrepo adminpw)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
sed -i.bak 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD="use_a_strong_password_here"/' "$d/apps/server/.env" && rm -f "$d/apps/server/.env.bak"
outcome "$d" scripts/prod/preflight.sh env
expect_status nonzero "the example's admin password is refused"
expect_out "ADMIN_PASSWORD" "naming it"
sed -i.bak 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD="Ab1-short"/' "$d/apps/server/.env" && rm -f "$d/apps/server/.env.bak"
outcome "$d" scripts/prod/preflight.sh env
expect_status nonzero "and so is one shorter than 12 characters"
sed -i.bak 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD="Abcdefghi-1"/' "$d/apps/server/.env" && rm -f "$d/apps/server/.env.bak"
outcome "$d" scripts/prod/preflight.sh env
expect_status nonzero "including one of 11 characters, the edge below the limit"
sed -i.bak 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD="Abcdefghij-1"/' "$d/apps/server/.env" && rm -f "$d/apps/server/.env.bak"
outcome "$d" scripts/prod/preflight.sh env
expect_status 0 "and one of exactly 12 is accepted"
sed -i.bak 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD="a-long-enough-admin-password"/' "$d/apps/server/.env" && rm -f "$d/apps/server/.env.bak"
outcome "$d" scripts/prod/preflight.sh env
expect_status 0 "a long password of one's own is accepted"

d="$(mkrepo vcompose)"
EXTRA_ENV="STUB_COMPOSE_VERSION=v2.39.4"; outcome "$d" scripts/prod/preflight.sh host; EXTRA_ENV=""
expect_status 0 "a Compose version printed with a leading v is read"

d="$(mkrepo deployflag)"
outcome "$d" scripts/prod/deploy.sh --bogus
expect_status nonzero "deploy.sh with an unknown option exits non-zero"
[ "$status" = 2 ] && ok "with status 2" || bad "with status 2 (exit $status)"
expect_out "Usage" "and prints the usage"

d="$(mkrepo stopfresh)"
outcome "$d" scripts/prod/deploy.sh --stop
expect_status 0 "--stop before anything was deployed is not an error"
expect_out "nothing to stop" "and says there is nothing to stop"
[ -s "$d/docker.log" ] && { bad "and calls no docker command"; show "$d/docker.log"; } || ok "and calls no docker command"

d="$(mkrepo devpw)"
cp "$d/infra/.env.example" "$d/infra/.env"
cp "$d/apps/server/.env.example" "$d/apps/server/.env"
outcome "$d" scripts/prod/deploy.sh
expect_status nonzero "a deploy with development passwords is refused"
expect_no_log "$d" "--build" "before anything is built"

d="$(mkrepo dirtydeploy)"
echo change >>"$d/README.md"
outcome "$d" scripts/prod/deploy.sh
expect_status nonzero "a deploy of a dirty tree is refused"
expect_no_log "$d" "--build" "before anything is built"

d="$(mkrepo stop)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
: >"$d/docker.log"
outcome "$d" scripts/prod/deploy.sh --stop
expect_status 0 "--stop stops"
expect_log "$d" "compose -f infra/compose.yml" "through the same Compose files"
expect_log "$d" " stop" "with stop"
if grep -E ' (up|down|build|rm)( |$)' "$d/docker.log" >/dev/null; then bad "and nothing else (no up, down, build or rm)"; show "$d/docker.log"; else ok "and nothing else (no up, down, build or rm)"; fi

# --- the flags of start.sh ------------------------------------------------------------------
# start.sh parses its flags before it does anything, so these are safe to run for real.
sh_out() { if bash "$root/start.sh" "$@" >"$work/out" 2>&1; then status=0; else status=$?; fi; }
sh_out --bogus
[ "$status" = 2 ] && ok "start.sh: an unknown flag exits 2" || { bad "start.sh: an unknown flag exits 2 (exit $status)"; show "$work/out"; }
expect_out "Usage" "and prints the usage"
sh_out --dev --prod
[ "$status" = 2 ] && ok "start.sh: --dev and --prod together exit 2" || bad "start.sh: --dev and --prod together exit 2 (exit $status)"
sh_out --stop
[ "$status" = 2 ] && ok "start.sh: --stop without --prod exits 2" || bad "start.sh: --stop without --prod exits 2 (exit $status)"
sh_out --allow-branch
[ "$status" = 2 ] && ok "start.sh: --allow-branch without --prod exits 2" || bad "start.sh: --allow-branch without --prod exits 2 (exit $status)"
sh_out --help
[ "$status" = 0 ] && ok "start.sh: --help exits 0" || bad "start.sh: --help exits 0 (exit $status)"
expect_out "--prod" "and describes --prod"

# --- start.sh: the hand-over to --prod, and the first run of --dev ---------------------------------
# A throwaway checkout that has start.sh and a stub for each tool the first run calls. The docker
# stub is told to fail (STUB_DOCKER_EXIT=1), so a --dev run ends where it would start the stores:
# everything it did before that is on record.
mkpy() { # mkpy <repo> <name> <ok|old>: a host python on the PATH; `old` fails the "3.12 or newer" probe
  sed -e "s/@NAME@/$2/g" -e "s/@PROBE@/$([ "$3" = ok ] && echo 0 || echo 1)/" >"$1/bin/$2" <<'EOF'
#!/bin/sh
echo "@NAME@ $*" >>"$STUB_LOG"
if [ "$1" = -c ]; then exit @PROBE@; fi
if [ "$1 $2" = "-m venv" ]; then
  s="$(dirname "$0")/../stubs"
  mkdir -p "$3/bin"
  cp "$s/python" "$s/pip" "$s/playwright" "$3/bin/"
fi
EOF
  chmod +x "$1/bin/$2"
}
mkdev() { # mkdev <name>: a repo as mkrepo makes it, plus what ./start.sh --dev reaches; prints its path
  d="$(mkrepo "$1")"
  cp "$root/start.sh" "$d/start.sh"
  mkdir -p "$d/apps/web" "$d/services/visualex" "$d/stubs"
  echo redis >"$d/services/visualex/requirements-dev.txt"
  # the venv that the host python "creates", and the tools inside it
  cat >"$d/stubs/python" <<'EOF'
#!/bin/sh
# `-c "import redis, playwright"` passes once pip has run
if [ "$1" = -c ]; then [ -e "$(dirname "$0")/../.deps" ]; exit; fi
echo "venv-python $*" >>"$STUB_LOG"
EOF
  cat >"$d/stubs/pip" <<'EOF'
#!/bin/sh
echo "pip $*" >>"$STUB_LOG"
touch "$(dirname "$0")/../.deps"
EOF
  cat >"$d/stubs/playwright" <<'EOF'
#!/bin/sh
echo "playwright $*" >>"$STUB_LOG"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/chromium-0"
EOF
  mkpy "$d" python3.14 ok
  cat >"$d/bin/npm" <<'EOF'
#!/bin/sh
echo "npm $*" >>"$STUB_LOG"
if [ "$1 $2" = "ci --prefix" ]; then mkdir -p "$3/node_modules"; fi
EOF
  printf '#!/bin/sh\nexit 1\n' >"$d/bin/lsof" # nothing listens on any port
  chmod +x "$d/stubs/python" "$d/stubs/pip" "$d/stubs/playwright" "$d/bin/npm" "$d/bin/lsof"
  echo "$d"
}
# runbash <repo> <script args...>: start.sh is a bash script. The variables a developer may have
# exported for their own runs are taken out, so a scenario does not depend on them.
runbash() {
  d="$1"; shift
  # shellcheck disable=SC2086
  ( cd "$d" && env -u MERLT_ENABLED -u MERLT_API_IN_DOCKER -u ADMIN_PASSWORD \
      PATH="$d/bin:$PATH" STUB_LOG="$d/docker.log" PLAYWRIGHT_BROWSERS_PATH="$d/pw" $EXTRA_ENV bash "$@" )
}
outcomeb() { if runbash "$@" >"$work/out" 2>&1; then status=0; else status=$?; fi; }
value_of() { sed -n "s/^$2=//p" "$1" | tail -1 | sed 's/^"\(.*\)"$/\1/'; } # value_of <file> <KEY>

# --prod hands over before anything of the development flow runs: were the dev env files made
# first, init-env.sh would find them and keep their development passwords, and the deploy would refuse.
d="$(mkdev handover)"
printf '#!/bin/sh\necho "DEPLOY $*"\n' >"$d/scripts/prod/deploy.sh"
outcomeb "$d" start.sh --prod --allow-branch --no-backup
expect_status 0 "start.sh --prod hands over to scripts/prod/deploy.sh"
expect_out "DEPLOY --allow-branch --no-backup" "with the options it was given"
if [ -e "$d/infra/.env" ] || [ -e "$d/apps/server/.env" ]; then bad "and made no development env file first"; else ok "and made no development env file first"; fi
if [ -s "$d/docker.log" ]; then bad "and started nothing of the development flow"; show "$d/docker.log"; else ok "and started nothing of the development flow"; fi
outcomeb "$d" start.sh --prod --stop
expect_out "DEPLOY --stop" "--prod --stop is handed over as it is"

# the first --dev run on a fresh checkout
d="$(mkdev dev)"
EXTRA_ENV="STUB_DOCKER_EXIT=1"; outcomeb "$d" start.sh; EXTRA_ENV=""
expect_out "--dev is the default" "start.sh without a flag runs --dev, and says so"
if [ -f "$d/infra/.env" ] && [ -f "$d/apps/server/.env" ]; then ok "the first run creates both env files"; else bad "the first run creates both env files"; fi
[ "$(mode_of "$d/apps/server/.env")" = "-rw-------" ] && ok "the server's readable by its owner only" || bad "the server's env file is readable by its owner only ($(mode_of "$d/apps/server/.env"))"
jwt="$(value_of "$d/apps/server/.env" JWT_SECRET)"
if [ "${#jwt}" -ge 32 ] && [ "$jwt" != "$(value_of "$d/apps/server/.env.example" JWT_SECRET)" ]; then ok "with a JWT secret of its own"; else bad "with a JWT secret of its own (${#jwt} characters, or the example's)"; fi
if grep -qF -- "$jwt" "$work/out"; then bad "which is not printed"; else ok "which is not printed"; fi
expect_log "$d" "python3.14 -m venv" "it creates the venv"
expect_log_re "$d" "pip install -q -r .*/services/visualex/requirements-dev.txt" "installs the Python dependencies"
expect_log_re "$d" "npm ci --prefix .*/apps/server$" "installs the server's packages"
expect_log_re "$d" "npm ci --prefix .*/apps/web$" "and the web app's"
expect_log "$d" "playwright install chromium" "installs Chromium"
expect_log "$d" "up -d --wait postgres redis falkordb qdrant" "and reaches the stores"
a="$(line_of "$d" 'docker info')"; b="$(line_of "$d" 'python3.14 -m venv')"; c="$(line_of "$d" 'up -d --wait')"
if [ -n "$a" ] && [ -n "$b" ] && [ -n "$c" ] && [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ]; then ok "in that order: Docker is checked, the dependencies come, then the stores"; else bad "in that order: Docker is checked ($a), the dependencies come ($b), then the stores ($c)"; show "$d/docker.log"; fi

# a second run: nothing that exists is redone
cp "$d/apps/server/.env" "$work/env.before"
: >"$d/docker.log"
EXTRA_ENV="STUB_DOCKER_EXIT=1"; outcomeb "$d" start.sh --dev; EXTRA_ENV=""
if grep -qF -- "is the default" "$work/out"; then bad "an explicit --dev does not say it is the default"; else ok "an explicit --dev does not say it is the default"; fi
cmp -s "$work/env.before" "$d/apps/server/.env" && ok "a second run does not touch the env files" || bad "a second run does not touch the env files"
for what in python3.14 "pip " "npm " "playwright "; do expect_no_log "$d" "$what" "and does not run '$what' again"; done
expect_log "$d" "up -d --wait" "and goes straight to the stores"

# Which python makes the venv: the first of the four that is 3.12 or newer, and `python3` counts.
d="$(mkdev pyfallback)"
for n in python3.14 python3.13 python3.12; do mkpy "$d" "$n" old; done
mkpy "$d" python3 ok
EXTRA_ENV="STUB_DOCKER_EXIT=1"; outcomeb "$d" start.sh; EXTRA_ENV=""
expect_log "$d" "python3 -m venv" "with only a plain python3 that qualifies, the venv is made with it"
expect_no_log "$d" "python3.14 -m venv" "and not with a python that failed the version probe"

d="$(mkdev pyold)"
for n in python3.14 python3.13 python3.12 python3; do mkpy "$d" "$n" old; done
EXTRA_ENV="STUB_DOCKER_EXIT=1"; outcomeb "$d" start.sh; EXTRA_ENV=""
expect_status nonzero "with no python 3.12 or newer, --dev stops"
expect_out "Python 3.12 or newer not found" "and says so"
expect_no_log "$d" "-m venv" "before making a venv with an old python"

# Docker off: it says so before it installs anything
d="$(mkdev nodocker)"
EXTRA_ENV="STUB_INFO_EXIT=1"; outcomeb "$d" start.sh; EXTRA_ENV=""
expect_status nonzero "with Docker not running, --dev stops"
expect_out "Docker is not running" "and says so"
for what in python3.14 "pip " "npm " "playwright "; do expect_no_log "$d" "$what" "before it runs '$what'"; done

exit "$fail"

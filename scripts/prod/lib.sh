# Shared by the scripts of ./start.sh --prod. POSIX sh; sourced, never run on its own.

say()  { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
err()  { printf 'error: %s\n' "$*" >&2; }

# The value of KEY in an env file, surrounding quotes removed; nothing when the file or
# the key is missing. Never printed by the callers: only compared and measured. It reads
# what Compose reads: an optional `export `, spaces around `=`, CRLF line endings, a quoted
# value (a `#` inside quotes stays), a comment after the value (` #...`, after a quote or
# after a bare value; a `#` with no space before it is part of the value). A KEY that
# Compose would find but this does not is how a deploy picks the wrong stack.
env_get() {
  [ -f "$1" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}$2[[:space:]]*=[[:space:]]*//p" "$1" \
    | tail -1 | tr -d '\r' \
    | sed -e 's/^"\([^"]*\)"[[:space:]]*\(#.*\)\{0,1\}$/\1/' -e t \
          -e "s/^'\([^']*\)'[[:space:]]*\(#.*\)\{0,1\}\$/\1/" -e t \
          -e 's/^#.*$//' -e 's/[[:space:]][[:space:]]*#.*$//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# env_set <file> <KEY> <value> [quote]: replace the KEY= line, or append it. The file is
# rewritten in place (cat, not mv), so its mode and owner stay what they were.
env_set() {
  _f="$1"; _k="$2"; _v="$3"; _q="${4:-}"
  _tmp="$_f.tmp.$$"
  V="$_v" awk -v k="$_k" -v q="$_q" '
    BEGIN { v = ENVIRON["V"]; done = 0 }
    $0 ~ "^" k "=" && !done { print k "=" q v q; done = 1; next }
    { print }
    END { if (!done) print k "=" q v q }
  ' "$_f" >"$_tmp" && cat "$_tmp" >"$_f" && rm -f "$_tmp"
}

# N characters from the system's random source, letters and digits only.
random_secret() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"
}

# 0 when the dotted version A is at least B (only the first three numbers count).
version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "[.-]"); split(b, y, ".")
    for (i = 1; i <= 3; i++) {
      if ((x[i] + 0) > (y[i] + 0)) exit 0
      if ((x[i] + 0) < (y[i] + 0)) exit 1
    }
    exit 0
  }'
}

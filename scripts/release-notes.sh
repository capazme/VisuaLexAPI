#!/bin/sh
# The merge titles between two refs, grouped by the kind of branch: the raw
# material of a CHANGELOG.md section (docs/git-workflow.md, "Release").
#
#   sh scripts/release-notes.sh v1.7.8            # v1.7.8..HEAD
#   sh scripts/release-notes.sh v1.7.8 develop
#
# Only the first-parent merges titled "merge: <branch> — <what changes>" count:
# each is one pull request that landed. The grouping is mechanical; grouping by
# area and rewording for readers is the editor's job.
set -eu
from="${1:?usage: release-notes.sh <from-ref> [<to-ref>]}"
to="${2:-HEAD}"

git log --first-parent --merges --reverse --format='%h %s' "$from..$to" |
awk '
  {
    hash = $1
    title = substr($0, length(hash) + 2)
    if (title !~ /^merge: /) next
    title = substr(title, 8)
    branch = title
    sub(/ .*/, "", branch)
    kind = branch
    sub(/\/.*/, "", kind)
    if (kind == "feat") g = 1
    else if (kind == "fix" || kind == "hotfix") g = 2
    else if (kind == "refactor") g = 3
    else if (kind == "docs") g = 4
    else if (kind == "chore" || kind == "dependabot") g = 5
    else g = 6
    lines[g] = lines[g] "- " title " (" hash ")\n"
  }
  END {
    split("Features|Fixes|Refactoring|Documentation|Maintenance|Other", names, "|")
    for (g = 1; g <= 6; g++)
      if (g in lines) printf "### %s\n\n%s\n", names[g], lines[g]
  }
'

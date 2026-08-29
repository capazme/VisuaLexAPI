"""The user-facing changelog, distilled from git's first-parent log.

`GET /version` used to hand the UI a raw `git log`: one line per development
step, bump commits and reverts included. Work lands on `main` through a merge
whose subject already summarises the whole branch, so the first-parent log is
the honest unit of "what changed" — and everything this module drops (reverted
work, housekeeping, toolchain fixes) is noise the reader cannot act on.

The functions here are pure: they take git's output as text so the rules can be
tested without a repository.
"""

from __future__ import annotations

import re
from typing import Any, Optional

# Commit types that describe work on the codebase, not a change to the product.
NOISE_TYPES = frozenset({'build', 'chore', 'ci', 'docs', 'refactor', 'style', 'test'})

# Scopes that mark a change to the toolchain, whatever the commit type says.
NOISE_SCOPES = frozenset({'ci', 'claude-md', 'deploy', 'deps', 'plan', 'test', 'tests'})

# How many entries the UI is willing to show.
DEFAULT_LIMIT = 20

# How far back to read before filtering, so a revert still finds its target.
SCAN_LIMIT = 200

_CONVENTIONAL = re.compile(
    r'^(?P<type>[a-z]+)(?:\((?P<scope>[^)]+)\))?!?:\s*(?P<summary>.+)$'
)

# `git revert` writes the reverted subject back into its own, quoted.
_REVERT = re.compile(r'^Revert "(?P<subject>.+)"$')

# A merge git named for us carries the branch, not the change it brought in.
_BARE_MERGE = re.compile(r"^Merge (branch|pull request|remote-tracking) ")


def build_changelog(raw_log: str, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """Turn `git log --first-parent --format=%h|%s|%ci|%an` into shown entries.

    Expects git's own order, newest first, which is what the revert pairing
    below reads: a revert cancels the nearest older commit with that subject,
    so a revert of a revert leaves the original work standing.
    """
    parsed = [entry for entry in (_parse_line(line) for line in raw_log.splitlines()) if entry]

    entries: list[dict[str, Any]] = []
    pending_reverts: list[str] = []
    for entry in parsed:
        subject = entry['message']

        if subject in pending_reverts:
            pending_reverts.remove(subject)
            continue

        revert = _REVERT.match(subject)
        if revert:
            pending_reverts.append(revert.group('subject'))
            continue

        if _BARE_MERGE.match(subject):
            continue

        if _is_noise(entry):
            continue

        entries.append(entry)
        if len(entries) == limit:
            break

    return entries


def changelog_range(version_file_log: str) -> Optional[str]:
    """The commit range holding the current version's changes.

    Takes `git log -n 2 --format=%H -- version.txt`. The deploy script stamps
    `version.txt` after building, so everything between the previous stamp and
    HEAD is what this version brought. Returns None before a second release
    exists, leaving the caller to fall back to a plain window of recent commits.
    """
    bumps = [line.strip() for line in version_file_log.splitlines() if line.strip()]
    if len(bumps) < 2:
        return None
    return f'{bumps[1]}..HEAD'


def _parse_line(line: str) -> Optional[dict[str, Any]]:
    parts = line.split('|', 3)
    if len(parts) < 4:
        return None

    commit_hash, subject, date, author = (part.strip() for part in parts)
    if not commit_hash or not subject:
        return None

    conventional = _CONVENTIONAL.match(subject)
    return {
        'hash': commit_hash,
        'message': subject,
        'date': date,
        'author': author,
        'type': conventional.group('type') if conventional else None,
        'scope': conventional.group('scope') if conventional else None,
        'summary': conventional.group('summary') if conventional else subject,
    }


def _is_noise(entry: dict[str, Any]) -> bool:
    return entry['type'] in NOISE_TYPES or entry['scope'] in NOISE_SCOPES

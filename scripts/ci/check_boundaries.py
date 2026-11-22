#!/usr/bin/env python3
"""Checks the seams that let the web app and the MCP server live in repositories of their own.

Two rules, read on the files git tracks:

* a file under ``apps/web/`` or ``apps/mcp/`` reaches nothing outside its own app folder, except
  ``conventions/`` (the folder every repository will hold at the same path);
* a file under ``apps/server/``, ``services/``, ``tools/``, ``scripts/`` or ``infra/ingress/*.mjs``
  imports or reads nothing under ``apps/web/`` or ``apps/mcp/``.

A crossing is found in three shapes: a relative string literal (``'../x'``) resolved against the
file's folder; a join of path segments (``join(dir, 'apps', 'server')``, ``/ "apps" / "server"``)
whose first two segments name a tracked path; a string literal that starts with a path of the
repository (``'apps/web/...'``). Comment-only lines, Markdown, ``docs/``, ``vendor/``, lockfiles and
``node_modules`` are not read.

ALLOWLIST holds the crossings still open: file -> (why, the pull request that removes it). The
check fails when a crossing is not listed and when a listed file no longer crosses, so the list can
only shrink. Standard library only; run from anywhere: ``python3 scripts/ci/check_boundaries.py``.
"""

from __future__ import annotations

import posixpath
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# file -> (why it still crosses, the pull request that removes it)
ALLOWLIST: dict[str, tuple[str, str]] = {
    "apps/web/src/content/novita/releaseNotes.test.ts": ("reads the repository's release notes and changelog", "PR-C"),
    "tools/e2e/docx-roundtrip/run.mjs": ("imports the web app's sources", "PR-C"),
}

APPS = ("apps/web", "apps/mcp")
ROOT_ONLY = {"version.txt", "CHANGELOG.md", "SECURITY.md", "start.sh", ".gitmodules"}
# Top-level folders of the repository a literal can start with.
TOP = ("apps", "services", "tools", "infra", "scripts", "conventions", "docs", "vendor")

# Shell scripts are not read: start.sh and scripts/prod name apps/web and apps/mcp as the build
# contexts of the production stack, which is not an import or a read of their files.
CODE_SUFFIXES = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py"}
CONFIG_NAMES = re.compile(r"^(package|tsconfig[\w.-]*)\.json$")
SKIP_PARTS = {"node_modules", "docs", "vendor"}
SKIP_FILES = {
    # This file names the paths it forbids.
    "scripts/ci/check_boundaries.py",
}
COMMENT_START = ("//", "/*", "*", "#", "<!--")

# One alternative per character: an escape, or any other character but the closing quote; never both
# (an ambiguous `\\.|.` backtracks exponentially on an unclosed quote full of backslashes).
QUOTED = re.compile(r"""(["'`])((?:\\.|(?!\1)[^\\])*)\1""")
# A template literal's interpolations: what follows each is still a path (`${ROOT}/services/…`).
PLACEHOLDER = re.compile(r"\$\{[^}]*\}")
# A Python f-string's or format string's fields: f"{ROOT}/apps/web/x".
PY_PLACEHOLDER = re.compile(r"\{[^}]*\}")
# A relative path inside a longer literal: "file:../server", "node ../../scripts/x.mjs".
INNER_UP = re.compile(r"(?<![\w.])(?:\.\./)+[^\s\"'`]*")
# A literal that is only parent steps, passed as an argument of its own: join(__dirname, '..', '..').
ONLY_UPS = re.compile(r"""(["'])((?:\.\.(?:/|(?=["'])))+)\1""")
JOIN = re.compile(r"""(["'])(%s)\1\s*\)?\s*[,/]\s*(["'])([^"'`]+)\3""" % "|".join(TOP))


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return [p for p in out.split("\0") if p]


def own_app(path: str) -> str | None:
    for app in APPS:
        if path.startswith(app + "/"):
            return app
    return None


def in_core(path: str) -> bool:
    if path.startswith(("apps/server/", "services/", "tools/", "scripts/")):
        return True
    return path.startswith("infra/ingress/") and path.endswith(".mjs")


def scanned(path: str) -> bool:
    if path in SKIP_FILES or SKIP_PARTS.intersection(path.split("/")):
        return False
    name = posixpath.basename(path)
    if name.endswith((".md", ".lock")) or name == "package-lock.json":
        return False
    return posixpath.splitext(name)[1] in CODE_SUFFIXES or bool(CONFIG_NAMES.match(name))


def is_comment(line: str) -> bool:
    return line.lstrip().startswith(COMMENT_START)


def docstring_state(line: str, inside: bool) -> tuple[bool, bool]:
    """(inside a triple-quoted block after this line, whether this line belongs to one)."""
    marks = len(re.findall(r'\"\"\"|\'\'\'', line))
    if inside:
        return (marks % 2 == 0), True
    if marks % 2 == 1:
        return True, True
    return False, marks > 0


def under(path: str, folder: str) -> bool:
    return path == folder or path.startswith(folder + "/")


def forbidden(target: str, app: str | None) -> bool:
    """Whether a repository-relative target is somewhere the file may not go."""
    if app:  # web or mcp: its own folder and conventions/ only
        return not (under(target, app) or under(target, "conventions"))
    return any(under(target, a) for a in APPS)


def crossings(path: str, text: str, prefixes: set[str], root_files: set[str] = frozenset()) -> list[tuple[int, str]]:
    """The lines of a file that reach where it may not go.

    Not seen, on purpose: Python strings in triple quotes and lines that start like a comment
    (`//`, `/*`, `*`, `#`) are read as prose; a path built from variables alone (no literal says
    where it goes) cannot be read from the text. Known misses, accepted: a root file after an
    interpolation (`${root}/CHANGELOG.md`), `cd ..` without a slash, and `${ROOT}/../x` (resolved
    against the file's folder). A URL with four `../` in it would be flagged: none exists.
    """
    app = own_app(path)
    folder = posixpath.dirname(path)
    # How many folders the file sits below its app's root: more parent steps than that leave the app.
    depth = len(folder.split("/")) - len(app.split("/")) if app else 0
    found: list[tuple[int, str]] = []
    python = path.endswith(".py")
    in_docstring = False
    for number, line in enumerate(text.splitlines(), 1):
        if python:
            # A docstring is prose that may quote a path; only the lines outside triple quotes are code.
            in_docstring, skip = docstring_state(line, in_docstring)
            if skip:
                continue
        if is_comment(line):
            continue
        for match in QUOTED.finditer(line if not python else line.replace("`", " ")):
            whole = match.group(2)
            pieces = (PY_PLACEHOLDER if python else PLACEHOLDER).split(whole)
            literal = pieces[0]
            # (a) relative literals, resolved against the file's folder
            if literal == ".." or literal.startswith("../"):
                target = posixpath.normpath(posixpath.join(folder, literal))
                # Outside the repository counts for the apps only: a core test may hold a hostile path.
                if (app and target.startswith("..")) or (not target.startswith("..") and forbidden(target, app)):
                    found.append((number, f"relative path {literal!r} reaches {target}"))
                continue
            # (a') a relative path inside a longer literal
            for inner in INNER_UP.finditer(whole):
                target = posixpath.normpath(posixpath.join(folder, inner.group(0)))
                # Outside the repository counts for the apps only: a core test may hold a hostile path.
                if (app and target.startswith("..")) or (not target.startswith("..") and forbidden(target, app)):
                    found.append((number, f"relative path {inner.group(0)!r} in {whole!r} reaches {target}"))
            # (c) literals, or what follows an interpolation, that start with a path of the repository
            for piece in [literal] + [p.lstrip("/") for p in pieces[1:]]:
                first = piece.split("/")[0]
                if "/" in piece and first in TOP:
                    if app and "/".join(piece.split("/")[:2]) in prefixes and forbidden(piece, app):
                        found.append((number, f"path {piece!r} is outside {app}"))
                    elif not app and forbidden(piece, app):
                        found.append((number, f"path {piece!r} is under the web or MCP folder"))
            # (d) a file of the repository's root the app does not have (version.txt, CHANGELOG.md)
            if app and whole in root_files:
                found.append((number, f"{whole!r} is a file of the repository's root, outside {app}"))
        # (e) parent steps passed one by one: join(__dirname, '..', '..', '..', '..')
        if app:
            ups = sum(m.group(2).count("..") for m in ONLY_UPS.finditer(line))
            if ups > depth:
                found.append((number, f"{ups} parent steps from a file {depth} folder(s) below {app}"))
        # (b) joins of path segments: 'apps', 'server' / "services" / "visualex"
        for match in JOIN.finditer(line):
            candidate = f"{match.group(2)}/{match.group(4)}"
            if candidate not in prefixes:
                continue
            if forbidden(candidate, app):
                found.append((number, f"path segments join to {candidate}"))
    return found


def main() -> int:
    files = tracked()
    # Every tracked directory at two levels, to tell a path of the repository from a word.
    prefixes = {"/".join(p.split("/")[:2]) for p in files if p.count("/") >= 1}
    prefixes = {p for p in prefixes if p.split("/")[0] in TOP}

    # Files only the repository's root has; LICENSE, README.md and the like are every package's too.
    # An app that has a file of the same name at its own root may name it.
    top_files = {p for p in files if "/" not in p} & ROOT_ONLY
    crossing: dict[str, list[tuple[int, str]]] = {}
    for path in files:
        if not scanned(path) or not (own_app(path) or in_core(path)):
            continue
        text = (ROOT / path).read_text(encoding="utf-8", errors="replace")
        app = own_app(path)
        root_files = {f for f in top_files if f"{app}/{f}" not in files} if app else set()
        found = crossings(path, text, prefixes, root_files)
        if found:
            crossing[path] = found

    problems: list[str] = []
    for path, found in sorted(crossing.items()):
        # An allowlisted file is exempt as a whole until its entry goes: the list only shrinks.
        if path in ALLOWLIST:
            continue
        for number, why in found:
            problems.append(f"{path}:{number}: {why}")
    for path, (why, pr) in sorted(ALLOWLIST.items()):
        if path not in crossing:
            problems.append(f"{path}: listed in ALLOWLIST ({why}; removed by {pr}) but it no longer crosses: delete the entry")

    if problems:
        print("The web app, the MCP server and the core must not reach into each other's folders:", file=sys.stderr)
        for line in problems:
            print("  " + line, file=sys.stderr)
        return 1
    print(f"boundaries ok: {len(crossing)} allowlisted crossing(s) left, {len(ALLOWLIST)} listed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""The Python dependencies are locked, and the ones that shape the text are pinned.

`article_text` is the offset space every highlight and note is anchored to (root
CLAUDE.md, rule 23). A different release of the HTML parser, of its CSS selector
engine or of the PDF text extractor can move one space and silently drop every
anchor after it. So:

- `requirements-lock.txt` pins every package, direct and transitive, to one exact
  version; the image installs from it and so does CI (through
  `requirements-dev.txt`), so the frozen-text tests run against what production runs;
- `requirements.txt` stays the human-edited list, and the libraries in
  `TEXT_SHAPING` are pinned there with `==`, the same version as in the lock;
- a bump of one of them has to change both files and then pass the frozen-text
  tests (`test_normattiva_extraction.py`, `test_decisions_text_frozen.py`):
  never a silent change.
"""

from __future__ import annotations

import re
from importlib import metadata
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

HERE = Path(__file__).resolve().parent.parent
REQUIREMENTS = HERE / "requirements.txt"
LOCK = HERE / "requirements-lock.txt"
DEV = HERE / "requirements-dev.txt"
DOCKERFILE = HERE / "Dockerfile"

#: The libraries whose output is, or decides, the characters of a stored text.
TEXT_SHAPING = ("beautifulsoup4", "soupsieve", "lxml", "pdfminer.six")


def _lines(path: Path) -> list[str]:
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line and not line.startswith("-"):
            out.append(line)
    return out


def _requirements(path: Path) -> dict[str, Requirement]:
    reqs = {}
    for line in _lines(path):
        req = Requirement(line)
        reqs[canonicalize_name(req.name)] = req
    return reqs


def _lock() -> dict[str, str]:
    pins = {}
    for name, req in _requirements(LOCK).items():
        specs = list(req.specifier)
        assert len(specs) == 1 and specs[0].operator == "==", (
            f"requirements-lock.txt: {req} is not one exact pin"
        )
        pins[name] = specs[0].version
    return pins


def test_the_lock_pins_every_package_exactly():
    assert LOCK.exists(), "services/visualex/requirements-lock.txt is missing"
    assert _lock(), "requirements-lock.txt is empty"


def test_every_direct_requirement_is_in_the_lock_and_satisfied():
    lock = _lock()
    for name, req in _requirements(REQUIREMENTS).items():
        assert name in lock, f"{req.name} is in requirements.txt but not in the lock"
        assert req.specifier.contains(lock[name], prereleases=True), (
            f"the lock's {req.name}=={lock[name]} does not satisfy requirements.txt's {req}"
        )


@pytest.mark.parametrize("name", TEXT_SHAPING)
def test_text_shaping_libraries_are_pinned_in_both_files(name):
    reqs = _requirements(REQUIREMENTS)
    key = canonicalize_name(name)
    assert key in reqs, f"{name} must be listed in requirements.txt"
    specs = list(reqs[key].specifier)
    assert len(specs) == 1 and specs[0].operator == "==", (
        f"{name} shapes the stored text: pin it with == in requirements.txt"
    )
    assert _lock()[key] == specs[0].version


@pytest.mark.parametrize("name", TEXT_SHAPING)
def test_the_installed_text_shaping_libraries_are_the_locked_ones(name):
    """The frozen-text tests prove something only if they ran on the locked versions."""
    installed = metadata.version(name)
    assert installed == _lock()[canonicalize_name(name)], (
        f"{name} {installed} is installed, the lock says {_lock()[canonicalize_name(name)]}: "
        f"reinstall with `pip install -r requirements-dev.txt`"
    )


def test_the_lock_has_a_name_dependabot_reads():
    """GitHub's dependency graph opens only `*.txt` requirements files: under another name
    `-r` in requirements-dev.txt fails it, and the service's security alerts stop."""
    assert LOCK.name.startswith("requirements") and LOCK.suffix == ".txt"


def test_the_image_and_ci_install_from_the_lock():
    docker = DOCKERFILE.read_text(encoding="utf-8")
    assert re.search(r"pip install[^\n]*-r requirements-lock\.txt", docker), (
        "the Dockerfile must install from requirements-lock.txt"
    )
    dev = [l.strip() for l in DEV.read_text(encoding="utf-8").splitlines()]
    assert "-r requirements-lock.txt" in dev, "requirements-dev.txt must pull the lock"

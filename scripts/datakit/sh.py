"""Subprocess helpers: every call is echoed and a failure raises."""
from __future__ import annotations

import subprocess
import sys
from typing import IO, Sequence


def run(args: Sequence[str], *, stdin: IO | None = None, stdout: IO | None = None,
        env: dict | None = None) -> str:
    args = [str(a) for a in args]
    print("+", " ".join(args), file=sys.stderr)
    captured = stdout is None
    result = subprocess.run(args, stdin=stdin, stdout=subprocess.PIPE if captured else stdout,
                            stderr=subprocess.PIPE, env=env, text=captured, check=False)
    if result.returncode != 0:
        err = result.stderr if isinstance(result.stderr, str) else result.stderr.decode(errors="replace")
        raise RuntimeError(f"{' '.join(args[:3])} failed ({result.returncode}): {err.strip()}")
    return result.stdout if captured else ""


def image_of(container: str) -> str:
    return run(["docker", "inspect", "-f", "{{.Config.Image}}", container]).strip()

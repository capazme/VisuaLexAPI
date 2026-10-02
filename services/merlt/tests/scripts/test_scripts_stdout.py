"""The scripts' stdout is theirs alone: their JSON is kept as it is printed.

`python -m` imports the `merlt` package before a script can configure logging, so
nothing on that import path may print to stdout."""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("module", ["merlt.scripts.migrate_graph_vocabulary", "merlt.scripts.retrieval_gate"])
def test_a_script_prints_nothing_before_its_own_output(module):
    done = subprocess.run(
        [sys.executable, "-m", module, "--help"], cwd=ROOT, capture_output=True, text=True, timeout=180, check=False,
    )
    assert done.returncode == 0, done.stderr
    assert done.stdout.startswith("usage:"), done.stdout[:300]

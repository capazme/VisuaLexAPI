"""Where the stores are: containers and volumes of a stack, overridable by name."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASES = ("visualex_platform", "merlt")
DEFAULT_VOLUMES = ("merlt_uploads", "merlt_checkpoints", "merlt_ner_models")
# Owner role of each database in the stack (infra/postgres/init).
DB_OWNERS = {"visualex_platform": "visualex", "visualex_test": "visualex", "merlt": "merlt"}


@dataclass(frozen=True)
class Target:
    stack: str
    compose_file: Path
    pg_container: str
    pg_user: str
    databases: tuple[str, ...]
    falkor_container: str
    qdrant_url: str
    volume_prefix: str
    volumes: tuple[str, ...]

    @classmethod
    def for_stack(cls, stack: str | None = None, **overrides) -> "Target":
        stack = stack or os.environ.get("VISUALEX_STACK", "visualex")
        values = {
            "stack": stack,
            "compose_file": REPO_ROOT / "infra" / "compose.yml",
            "pg_container": f"{stack}-postgres",
            "pg_user": "postgres",
            "databases": DEFAULT_DATABASES,
            "falkor_container": f"{stack}-falkordb",
            "qdrant_url": f"http://127.0.0.1:{os.environ.get('VISUALEX_QDRANT_PORT', '6343')}",
            "volume_prefix": f"{stack}_",
            "volumes": DEFAULT_VOLUMES,
        }
        values.update({key: value for key, value in overrides.items() if value is not None})
        return cls(**values)

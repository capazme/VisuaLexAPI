"""Where the stores are: containers and volumes of a stack, overridable by name."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
# The variables Compose interpolates infra/compose.yml with: stack name, ports.
ENV_FILE = REPO_ROOT / "infra" / ".env"
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
    def for_stack(cls, stack: str | None = None, env_file: Path | None = None, **overrides) -> "Target":
        file_values = read_env_file(ENV_FILE if env_file is None else env_file)

        def setting(name: str, default: str) -> str:
            # Compose's order: the shell, then the env file, then the default.
            return os.environ.get(name) or file_values.get(name) or default

        stack = stack or setting("VISUALEX_STACK", "visualex")
        values = {
            "stack": stack,
            "compose_file": REPO_ROOT / "infra" / "compose.yml",
            "pg_container": f"{stack}-postgres",
            "pg_user": "postgres",
            "databases": DEFAULT_DATABASES,
            "falkor_container": f"{stack}-falkordb",
            "qdrant_url": f"http://127.0.0.1:{setting('VISUALEX_QDRANT_PORT', '6343')}",
            "volume_prefix": f"{stack}_",
            "volumes": DEFAULT_VOLUMES,
        }
        values.update({key: value for key, value in overrides.items() if value is not None})
        return cls(**values)


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE pairs of an env file: blanks and comments skipped, one pair of quotes stripped."""
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return {}
    values = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values

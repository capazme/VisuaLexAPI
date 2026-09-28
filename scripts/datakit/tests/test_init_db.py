"""infra/postgres/init creates the roles whatever their passwords contain.

Needs Docker: run with DATAKIT_DOCKER_TESTS=1. A throwaway stack, own port.
The init script runs once per volume: if it fails, the volume stays without
roles for good, so a password with a quote must not break it.
"""
import os
import subprocess

import pytest

from datakit.target import REPO_ROOT

pytestmark = pytest.mark.skipif(
    os.environ.get("DATAKIT_DOCKER_TESTS") != "1", reason="needs Docker: set DATAKIT_DOCKER_TESTS=1"
)

STACK = "datakit-initdb"
COMPOSE = ["docker", "compose", "-f", str(REPO_ROOT / "infra" / "compose.yml"), "-p", STACK]
PASSWORDS = {"PLATFORM_DB_PASSWORD": "it's a pa$$ word", "MERLT_DB_PASSWORD": 'q"uo;te\\'}


def test_roles_accept_passwords_with_quotes():
    env = dict(os.environ, VISUALEX_STACK=STACK, VISUALEX_PG_PORT="55437", **PASSWORDS)
    try:
        subprocess.run([*COMPOSE, "up", "-d", "--wait", "postgres"], env=env, check=True, capture_output=True)
        for role, db, var in (("visualex", "visualex_platform", "PLATFORM_DB_PASSWORD"),
                              ("merlt", "merlt", "MERLT_DB_PASSWORD")):
            # From another container, so the password is really checked (not local trust).
            out = subprocess.run(
                ["docker", "run", "--rm", "--network", f"{STACK}_default", "-e", f"PGPASSWORD={PASSWORDS[var]}",
                 "postgres:16-alpine", "psql", "-h", "postgres", "-U", role, "-d", db, "-Atc", "select current_user"],
                check=True, capture_output=True, text=True,
            ).stdout
            assert out.strip() == role
    finally:
        subprocess.run([*COMPOSE, "down", "-v"], env=env, check=False, capture_output=True)

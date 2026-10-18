"""Check 10 (platform DB migrated) reads DATABASE_URL when it is set and skips, plainly, when it is not."""

from e2e.preflight import SKIP_PREFIX, migration_env, result_of


def test_database_url_from_the_environment_is_passed_to_prisma():
    env = migration_env({"PATH": "/bin", "DATABASE_URL": "postgresql://u@h/visualex_platform"})
    assert env is not None
    assert env["DATABASE_URL"] == "postgresql://u@h/visualex_platform"
    assert env["PATH"] == "/bin"


def test_no_database_url_means_no_probe():
    assert migration_env({"PATH": "/bin"}) is None
    assert migration_env({"DATABASE_URL": "   "}) is None


def test_a_skipped_check_is_reported_as_skip_and_is_not_a_failure():
    detail = f"{SKIP_PREFIX} DATABASE_URL not set: migrations not verified"
    assert result_of(True, detail, hard=True) == "SKIP"


def test_a_passing_check_is_ok_and_a_failing_hard_check_fails():
    assert result_of(True, "schema up to date", hard=True) == "OK"
    assert result_of(False, "Prisma CLI error", hard=True) == "FAIL"
    assert result_of(False, "Prisma CLI error", hard=False) == "SOFT-FAIL"

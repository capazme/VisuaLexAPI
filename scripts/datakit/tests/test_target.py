"""The target follows infra/.env the way Compose does: shell, then file, then default."""
from datakit.target import Target


def test_the_stack_file_names_the_stack_and_its_qdrant_port(tmp_path, monkeypatch):
    monkeypatch.delenv("VISUALEX_STACK", raising=False)
    monkeypatch.delenv("VISUALEX_QDRANT_PORT", raising=False)
    env = tmp_path / "stack.env"
    env.write_text('# comment\n\nVISUALEX_STACK=other\nVISUALEX_QDRANT_PORT="7333"\n')
    t = Target.for_stack(env_file=env)
    assert (t.stack, t.pg_container, t.volume_prefix, t.qdrant_url) == (
        "other", "other-postgres", "other_", "http://127.0.0.1:7333")


def test_the_shell_wins_over_the_stack_file(tmp_path, monkeypatch):
    env = tmp_path / "stack.env"
    env.write_text("VISUALEX_STACK=other\nVISUALEX_QDRANT_PORT=7333\n")
    monkeypatch.setenv("VISUALEX_STACK", "shell")
    monkeypatch.setenv("VISUALEX_QDRANT_PORT", "8333")
    t = Target.for_stack(env_file=env)
    assert (t.stack, t.qdrant_url) == ("shell", "http://127.0.0.1:8333")


def test_without_a_stack_file_the_defaults_hold(tmp_path, monkeypatch):
    monkeypatch.delenv("VISUALEX_STACK", raising=False)
    monkeypatch.delenv("VISUALEX_QDRANT_PORT", raising=False)
    t = Target.for_stack(env_file=tmp_path / "absent.env")
    assert (t.stack, t.qdrant_url) == ("visualex", "http://127.0.0.1:6343")

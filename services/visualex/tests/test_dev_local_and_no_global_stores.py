"""The Python API in development (item 15 of the security inventory).

- `python app.py` serves this machine alone unless HOST says otherwise: a laptop on a shared
  network no longer serves the API to the room. `start.sh` passes HOST=0.0.0.0 when MERL-T runs,
  since its containers reach the API from the Docker network.
- No global /history nor /dossiers: they had no login and held one search history and one set of
  dossiers for whoever reached the port. The history and the dossiers are the server's, per user.
"""
import pytest

import app as app_module

GLOBAL_STORES = ("/history", "/dossiers")


def test_main_binds_this_machine_alone_by_default(monkeypatch):
    seen = {}
    monkeypatch.delenv("HOST", raising=False)
    monkeypatch.setattr(app_module.NormaController, "__init__", lambda self: None)

    class FakeApp:
        def run(self, host, port):
            seen.update(host=host, port=port)

    monkeypatch.setattr(app_module.NormaController, "app", FakeApp(), raising=False)
    app_module.main()
    assert seen["host"] == "127.0.0.1"


def test_host_still_opens_it_when_asked(monkeypatch):
    seen = {}
    monkeypatch.setenv("HOST", "0.0.0.0")
    monkeypatch.setattr(app_module.NormaController, "__init__", lambda self: None)

    class FakeApp:
        def run(self, host, port):
            seen.update(host=host, port=port)

    monkeypatch.setattr(app_module.NormaController, "app", FakeApp(), raising=False)
    app_module.main()
    assert seen["host"] == "0.0.0.0"


@pytest.mark.parametrize("path", GLOBAL_STORES)
def test_no_global_history_or_dossiers(path):
    rules = [rule.rule for rule in app_module.NormaController().app.url_map.iter_rules()]
    assert not [rule for rule in rules if rule == path or rule.startswith(path + "/")]

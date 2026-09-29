"""TRUSTED_PROXIES is read once, at import: an empty value must not crash it."""
import importlib

import pytest

from visualex_api.tools import config


@pytest.fixture(autouse=True)
def restore_config():
    # Set up before, torn down after monkeypatch: the environment is back to
    # normal when the module is reloaded for the next test.
    yield
    importlib.reload(config)


@pytest.mark.parametrize("value, expected", [("", 0), ("0", 0), ("1", 1), ("2", 2)])
def test_the_environment_sets_the_count(monkeypatch, value, expected):
    monkeypatch.setenv("TRUSTED_PROXIES", value)
    assert importlib.reload(config).TRUSTED_PROXIES == expected


def test_unset_means_no_proxy_is_trusted(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXIES", raising=False)
    assert importlib.reload(config).TRUSTED_PROXIES == 0

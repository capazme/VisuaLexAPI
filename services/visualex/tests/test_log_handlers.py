"""File logging is optional, so a container with a read-only root can start.

Three modules used to open `norma.log` in the working directory the moment they
were imported: on a read-only filesystem the application never came up.
"""
import logging

import pytest

from visualex_api.tools.logging_config import log_handlers


@pytest.fixture
def opened():
    handlers = []
    yield handlers
    for handler in handlers:
        handler.close()


def test_a_log_file_is_written_by_default(tmp_path, monkeypatch, opened):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("VISUALEX_LOG_FILE", raising=False)
    opened.extend(log_handlers("norma.log"))
    assert any(isinstance(h, logging.FileHandler) for h in opened)
    assert (tmp_path / "norma.log").exists()


def test_an_empty_setting_means_no_file_at_all(tmp_path, monkeypatch, opened):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("VISUALEX_LOG_FILE", "")
    opened.extend(log_handlers("norma.log"))
    assert not any(isinstance(h, logging.FileHandler) for h in opened)
    assert list(tmp_path.iterdir()) == []


def test_the_setting_names_the_file(tmp_path, monkeypatch, opened):
    target = tmp_path / "elsewhere.log"
    monkeypatch.setenv("VISUALEX_LOG_FILE", str(target))
    opened.extend(log_handlers("norma.log"))
    files = [h for h in opened if isinstance(h, logging.FileHandler)]
    assert [h.baseFilename for h in files] == [str(target)]


def test_the_console_handler_is_always_there(monkeypatch, opened):
    monkeypatch.setenv("VISUALEX_LOG_FILE", "")
    opened.extend(log_handlers("norma.log"))
    assert any(type(h) is logging.StreamHandler for h in opened)

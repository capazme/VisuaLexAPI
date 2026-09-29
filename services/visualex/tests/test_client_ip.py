"""Which address the rate limiter counts a request against.

X-Forwarded-For is written by whoever sends the request. It is believed only as
far as the number of proxies we run in front of the service, and not at all by
default: a service reached directly must not let a caller pick its own bucket.
"""
import pytest

import app as app_module
from app import NormaController
from visualex_api.tools.client_ip import client_address


def test_the_header_is_ignored_when_no_proxy_is_trusted():
    assert client_address("1.2.3.4", "10.0.0.5", 0) == "10.0.0.5"


def test_one_trusted_proxy_means_the_last_entry():
    # client -> proxy -> service: the proxy appended the address it saw.
    assert client_address("6.6.6.6, 1.2.3.4", "10.0.0.5", 1) == "1.2.3.4"


def test_two_trusted_proxies_mean_the_second_entry_from_the_right():
    assert client_address("6.6.6.6, 1.2.3.4, 10.9.9.9", "10.0.0.5", 2) == "1.2.3.4"


def test_a_header_shorter_than_the_trusted_count_falls_back():
    assert client_address("1.2.3.4", "10.0.0.5", 2) == "10.0.0.5"


@pytest.mark.parametrize("header", [None, "", "  ,  "])
def test_a_missing_or_blank_header_falls_back(header):
    assert client_address(header, "10.0.0.5", 1) == "10.0.0.5"


def test_no_address_at_all_still_gives_a_stable_key():
    assert client_address(None, None, 0) == "unknown"


@pytest.fixture(autouse=True)
def fresh_counters():
    app_module.request_counts.clear()
    yield
    app_module.request_counts.clear()


async def test_a_spoofed_forwarded_header_does_not_dodge_the_limit(monkeypatch):
    monkeypatch.setattr(app_module, "RATE_LIMIT", 2)
    monkeypatch.setattr(app_module, "TRUSTED_PROXIES", 0)
    client = NormaController().app.test_client()
    statuses = []
    for spoof in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
        response = await client.get("/health", headers={"X-Forwarded-For": spoof})
        statuses.append(response.status_code)
    assert statuses == [200, 200, 429]


async def test_behind_a_trusted_proxy_each_client_has_its_own_budget(monkeypatch):
    monkeypatch.setattr(app_module, "RATE_LIMIT", 1)
    monkeypatch.setattr(app_module, "TRUSTED_PROXIES", 1)
    client = NormaController().app.test_client()
    first = await client.get("/health", headers={"X-Forwarded-For": "1.1.1.1"})
    second = await client.get("/health", headers={"X-Forwarded-For": "2.2.2.2"})
    again = await client.get("/health", headers={"X-Forwarded-For": "1.1.1.1"})
    assert (first.status_code, second.status_code, again.status_code) == (200, 200, 429)

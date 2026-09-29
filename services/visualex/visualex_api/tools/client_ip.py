"""The address a request is counted against by the rate limiter."""
from __future__ import annotations


def client_address(
    forwarded_for: str | None, remote_addr: str | None, trusted_proxies: int
) -> str:
    """Return the address to key a request on.

    ``X-Forwarded-For`` is written by whoever sends the request, so it is believed
    only as far as the number of proxies we run in front of this service. With none
    (the default) it is ignored: a service reached directly must not let a caller
    pick its own bucket, which is what made the per-IP limit meaningless.

    Each trusted proxy appends the address it received the request from, so with N
    of them the client is the N-th entry from the right; whatever the caller wrote
    before that is discarded. A header with fewer entries than proxies, or none, falls
    back to the address of the connection itself.
    """
    fallback = remote_addr or "unknown"
    if trusted_proxies <= 0 or not forwarded_for:
        return fallback
    hops = [hop.strip() for hop in forwarded_for.split(",") if hop.strip()]
    if len(hops) < trusted_proxies:
        return fallback
    return hops[-trusted_proxies]

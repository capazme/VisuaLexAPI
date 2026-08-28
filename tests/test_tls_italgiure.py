import inspect
import ssl

import pytest

from visualex_api.tools import tls


def test_module_never_disables_verification():
    """The previous round re-enabled TLS verification repo-wide. This module
    exists to KEEP it on for a host with an incomplete chain — the opposite of
    turning it off. If someone ever reaches for the easy fix, this fails."""
    src = inspect.getsource(tls)
    assert "CERT_NONE" not in src
    assert "check_hostname = False" not in src
    assert "ssl=False" not in src


@pytest.mark.live
async def test_context_verifies_italgiure():
    ctx = await tls.italgiure_ssl_context()
    assert ctx.verify_mode is ssl.CERT_REQUIRED
    assert ctx.check_hostname is True

    import asyncio
    reader, writer = await asyncio.open_connection(
        "www.italgiure.giustizia.it", 443, ssl=ctx,
        server_hostname="www.italgiure.giustizia.it",
    )
    writer.close()
    await writer.wait_closed()

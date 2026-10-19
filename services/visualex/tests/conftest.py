import pytest

pytest_plugins = ("pytest_asyncio",)

from visualex_api.tools.exceptions import NetworkError

#: What ThrottledHttpClient.request raises once its own retries are spent. A 404
#: (DocumentNotFoundError) is not here: it means a moved endpoint, and fails a live test.
TRANSPORT_ERRORS = (NetworkError,)


def skip_if_unreachable(source: str, exc: Exception) -> None:
    """A live source that cannot be reached is a skip, never a failure."""
    pytest.skip(f"{source} unreachable: {exc}")

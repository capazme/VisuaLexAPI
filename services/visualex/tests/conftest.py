import pytest

pytest_plugins = ("pytest_asyncio",)

from visualex_api.tools.exceptions import DocumentNotFoundError, NetworkError

#: What ThrottledHttpClient.request raises once its own retries are spent.
TRANSPORT_ERRORS = (NetworkError, DocumentNotFoundError)


def skip_if_unreachable(source: str, exc: Exception) -> None:
    """A live source that cannot be reached is a skip, never a failure."""
    pytest.skip(f"{source} unreachable: {exc}")

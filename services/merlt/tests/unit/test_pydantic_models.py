"""The API's Pydantic models carry no deprecated class-based `Config`.

`class Config:` is deprecated since Pydantic 2.0 (removed in 3.0) and prints a warning every time
the module is imported, which is every test run and every API start. A model says
`model_config = ConfigDict(...)` instead, with the same settings.
"""
import subprocess
import sys
from datetime import datetime
from types import SimpleNamespace

from merlt.api.models.document_models import DocumentInfo, PendingAmendmentInfo


# The filter is installed in code, not with `-W`: the command line ignores a category that is not a
# built-in one ("Invalid -W option ignored"), and a test that checks nothing passes for any code.
IMPORT_THE_API_WITH_PYDANTIC_WARNINGS_AS_ERRORS = """
import warnings
from pydantic.warnings import PydanticDeprecatedSince20
warnings.simplefilter("error", PydanticDeprecatedSince20)
import merlt.api
"""


def test_the_api_imports_without_a_pydantic_deprecation_warning():
    # A fresh interpreter: the warning fires once, when the module is first imported, so an
    # in-process check would see nothing after the first test that imported it.
    result = subprocess.run(
        [sys.executable, "-c", IMPORT_THE_API_WITH_PYDANTIC_WARNINGS_AS_ERRORS], capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr[-800:]


def test_a_document_is_read_from_an_object_with_attributes():
    row = SimpleNamespace(
        id=7, filename="nota.pdf", file_type="pdf", file_size_bytes=1024, processing_status="completed",
        uploaded_by="u1", created_at=datetime(2026, 10, 1),
    )
    info = DocumentInfo.model_validate(row)  # `from_attributes`: the settings the class Config had
    assert (info.id, info.filename, info.processing_status) == (7, "nota.pdf", "completed")


def test_a_pending_amendment_is_read_from_an_object_with_attributes():
    row = SimpleNamespace(
        id=3, amendment_id="a-1", target_article_urn="urn:x", atto_modificante_estremi="L. 1/2020", tipo_modifica="MODIFICA",
        disposizione="art. 1", validation_status="pending", approval_score=0.0, rejection_score=0.0, votes_count=0,
        consensus_reached=False, contributed_by="u1", created_at=datetime(2026, 10, 1),
    )
    info = PendingAmendmentInfo.model_validate(row)
    assert (info.amendment_id, info.tipo_modifica, info.consensus_reached) == ("a-1", "MODIFICA", False)

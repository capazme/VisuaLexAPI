"""`append_version_info` reads the version words the way `is_historical_request` does.

`is_historical_request` strips and lower-cases the word; the URN builder used to
compare it exactly, so a hand-edited or imported item (`" Originale "`) was
treated as a past request but got a URN with no version suffix: the text in
force came back, labelled and cited as the original.
"""

from visualex_api.tools.text_op import parse_date
from visualex_api.tools.urngenerator import append_version_info


def test_originale_is_read_stripped():
    assert append_version_info("u", " Originale ", None) == "u@originale"


def test_originale_is_read_case_insensitively():
    assert append_version_info("u", "ORIGINALE", None) == "u@originale"


def test_vigente_with_a_day_keeps_the_day_whatever_the_case():
    urn = append_version_info("u", "Vigente", "2007-12-29")
    assert urn == "u!vig=" + parse_date("2007-12-29")
    assert urn != "u!vig="


def test_vigente_without_a_day_is_the_bare_marker():
    assert append_version_info("u", "vigente", None) == "u!vig="


def test_no_version_leaves_the_urn_alone():
    assert append_version_info("u", None, None) == "u"


def test_an_unknown_word_leaves_the_urn_alone():
    assert append_version_info("u", "altro", None) == "u"

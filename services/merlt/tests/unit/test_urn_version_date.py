"""A date in a request always asks for the text in force on that day (owner, G-353).

MERL-T's copy of the API's append_version_info: a date with no version, or with
«originale», used to reach Normattiva without it and came back as today's text.
"""
from merlt.utils.urngenerator import _append_version_info, generate_urn

BASE = "urn:nir:stato:legge:1990-08-07;241~art2"


def test_a_date_asks_for_the_text_in_force_on_that_day_whatever_the_version():
    for version in (None, "", "vigente", " Vigente ", "originale"):
        assert _append_version_info(BASE, version, "2020-01-15") == BASE + "!vig=2020-01-15", version


def test_without_a_date_the_version_word_decides():
    assert _append_version_info(BASE, "originale", None) == BASE + "@originale"
    assert _append_version_info(BASE, " ORIGINALE ", "") == BASE + "@originale"
    assert _append_version_info(BASE, "vigente", None) == BASE + "!vig="
    assert _append_version_info(BASE, None, None) == BASE


def test_a_date_that_cannot_be_read_is_left_out():
    assert _append_version_info(BASE, "vigente", "not a date") == BASE + "!vig="
    assert _append_version_info(BASE, "originale", "not a date") == BASE + "@originale"


def test_generate_urn_carries_the_date():
    urn = generate_urn("legge", date="1990-08-07", act_number="241", article="2", version_date="2020-01-15")
    assert urn.endswith("~art2!vig=2020-01-15")

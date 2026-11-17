"""The recital clause in a search (spec docs/superpowers/specs/2026-11-17-eu-recitals-design.md §3.1)."""
import pytest

from visualex_api.tools.recital_clause import expand_recital_spec, split_recital_clause


@pytest.mark.parametrize("typed,spec,rest", [
    # The spec's table, §3.1
    ("considerando 26 GDPR", "26", "GDPR"),
    ("cons. 26 reg. 2016/679", "26", "reg. 2016/679"),
    ("considerando n. 26 del regolamento (UE) 2016/679", "26", "del regolamento (UE) 2016/679"),
    ("considerando (26) GDPR", "26", "GDPR"),
    ("GDPR, considerando 26", "26", "GDPR"),
    ("considerando 26-30 GDPR", "26-30", "GDPR"),
    ("considerando 2 direttiva 2002/58/CE", "2", "direttiva 2002/58/CE"),
    ("considerando 26", "26", ""),
    ("considerando 3 l. 241/1990", "3", "l. 241/1990"),
    ("art. 4 e considerando 26 GDPR", "26", "art. 4 GDPR"),
    # The heads and the «n.»
    ("Cons 26 GDPR", "26", "GDPR"),
    ("consid. 26 GDPR", "26", "GDPR"),
    ("considerando n° 26 GDPR", "26", "GDPR"),
    ("considerando nr. 26 GDPR", "26", "GDPR"),
    # Lists and ranges
    ("considerando 26 e 27 GDPR", "26,27", "GDPR"),
    ("considerando 26, 27 e 30 GDPR", "26,27,30", "GDPR"),
    ("considerando (26)-(30) GDPR", "26-30", "GDPR"),
    # The clause last, after the act
    ("reg. (UE) 2016/679, considerando 26", "26", "reg. (UE) 2016/679"),
    ("GDPR considerando 26", "26", "GDPR"),
])
def test_the_clause_and_the_rest(typed, spec, rest):
    assert split_recital_clause(typed) == (spec, rest)


@pytest.mark.parametrize("typed", [
    "Cons. St., sez. VI, n. 2270/2019",  # a Consiglio di Stato decision
    "considerando il contratto",  # a head with no number
    "considerando 026 GDPR",  # a leading zero
    "considerando 26/2016",  # a date, not a recital
    "considerando 30-26 GDPR",  # a range that runs backwards
    "considerando 1-151 GDPR",  # past the ceiling once expanded
    "considerando ٢٦ GDPR",  # digits of another script
    "art. 2043 c.c.",
    "",
])
def test_no_clause(typed):
    assert split_recital_clause(typed) == (None, typed)


def test_a_range_of_150_is_the_ceiling():
    assert split_recital_clause("considerando 1-150 GDPR") == ("1-150", "GDPR")


def test_expand_a_range_and_a_list():
    assert expand_recital_spec("26-28") == ["26", "27", "28"]
    assert expand_recital_spec("26,30") == ["26", "30"]
    assert expand_recital_spec("26") == ["26"]

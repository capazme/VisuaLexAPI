"""normalize_act_type strips spaces from the lookup key while the tables' keys
contain spaces, so every multi-word abbreviation is dead today."""
import pytest

from visualex_api.tools.map import NORMATTIVA, NORMATTIVA_SEARCH
from visualex_api.tools.text_op import normalize_act_type


class TestMultiWordKeysAreReachable:
    @pytest.mark.parametrize("abbrev", ["cod. civ.", "cod. pen.", "disp. att. c.c."])
    def test_spaced_abbreviations_resolve(self, abbrev):
        if abbrev not in NORMATTIVA:
            pytest.skip(f"{abbrev!r} is not in the table")
        assert normalize_act_type(abbrev) == NORMATTIVA[abbrev]

    def test_no_key_is_unreachable(self):
        unreachable = [k for k in NORMATTIVA if normalize_act_type(k) != NORMATTIVA[k]]
        assert not unreachable, f"{len(unreachable)} keys unreachable: {unreachable[:5]}"

    def test_search_table_keys_are_reachable_too(self):
        unreachable = [
            k for k in NORMATTIVA_SEARCH
            if normalize_act_type(k, search=True) != NORMATTIVA_SEARCH[k]
        ]
        assert not unreachable, f"{len(unreachable)} unreachable: {unreachable[:5]}"


class TestSpacelessAbbreviationsStillWork:
    # NOTE: with search=False the table is NORMATTIVA, whose values are the
    # DOTTED URN forms — NORMATTIVA["rd"] is "regio.decreto", not
    # "regio decreto". The plan's draft asserted the spaced form here, which
    # contradicted its own test_no_key_is_unreachable in the same file.
    # Preserving existing behaviour means preserving the table's own value.
    @pytest.mark.parametrize("abbrev,expected", [("cc", "codice civile"), ("rd", "regio.decreto")])
    def test_existing_behaviour_is_preserved(self, abbrev, expected):
        assert normalize_act_type(abbrev) == expected


class TestUrnGenerationIsUnaffected:
    def test_no_double_dots_in_the_urn(self):
        """generate_urn compensates with its own .replace(' ', '.'), so a
        normaliser that now returns 'regio decreto' must not produce
        'regio..decreto' downstream."""
        from visualex_api.tools.urngenerator import generate_urn

        urn = generate_urn("regio decreto", date="1942-03-16", act_number="262")
        assert ".." not in urn
        assert "regio.decreto" in urn

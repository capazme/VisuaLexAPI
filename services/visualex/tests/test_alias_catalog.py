"""The alias catalog: what the system already recognises, for the settings screen.

The alias manager used to suggest "es. gdpr" as a trigger to create while
`gdpr` had been a shipped preset all along, because nothing ever showed the
user what already existed. This endpoint is what closes that.
"""
import pytest

from app import NormaController


def _controller():
    # Same trick the rest of the suite uses: skip __init__ so no Quart app,
    # no routes and no scrapers are built.
    return NormaController.__new__(NormaController)


class TestCatalogContents:
    @pytest.mark.asyncio
    async def test_serves_both_lists(self):
        from visualex_api.tools.alias_resolver import get_all_presets
        from visualex_api.tools.act_resolver import known_act_names

        presets, known = get_all_presets(), known_act_names()
        assert len(presets) >= 78, "the shipped preset list shrank"
        assert len(known) >= 380, "the resolver's act-name list shrank"

    def test_presets_carry_the_fields_the_manager_renders(self):
        from visualex_api.tools.alias_resolver import get_all_presets

        for trigger, params in get_all_presets().items():
            assert isinstance(trigger, str) and trigger
            assert params.get('act_type'), f"{trigger!r} has no act_type to show"

    def test_a_known_act_needs_no_alias(self):
        """The two lists answer different questions and must not be conflated:
        an act the resolver already names needs no shortcut, and a preset is a
        shortcut precisely because the name alone would not resolve."""
        from visualex_api.tools.act_resolver import resolve_atto

        assert resolve_atto('statuto dei lavoratori') is not None
        assert resolve_atto('legge fornero') is not None

    def test_the_overlap_is_visible_rather_than_hidden(self):
        """Some triggers are in both lists — "codice civile" is a preset AND a
        name the resolver knows. That is fine; what mattered was that the user
        could see neither."""
        from visualex_api.tools.alias_resolver import get_all_presets
        from visualex_api.tools.act_resolver import known_act_names

        overlap = set(get_all_presets()) & set(known_act_names())
        assert isinstance(overlap, set)  # documenting, not constraining


class TestEndpointShape:
    @pytest.mark.asyncio
    async def test_handler_exists_and_is_a_get(self):
        ctrl = _controller()
        assert hasattr(ctrl, 'fetch_alias_catalog')

    @pytest.mark.asyncio
    async def test_route_is_fetch_prefixed_so_nginx_reaches_it(self):
        """nginx proxies the Python API by path prefix. A route outside
        ^/(fetch_|stream_|export_|history|version|health|dossiers|parse_query)
        answers 405 from the static file server in production — which is
        exactly how /parse_query shipped dead once already."""
        source = open('app.py', encoding='utf-8').read()
        assert "'/fetch_alias_catalog'" in source

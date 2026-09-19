"""The EUR-Lex fixtures carry the markers the parsers are written against.

If a fixture is re-captured and a marker disappears, the parser tests would
fail for the wrong reason; this file names the real one.
"""
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"


def _read(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_modern_oj_fixture_has_recitals_articles_and_headings():
    html = _read("gdpr_oj_trimmed.html")
    for marker in ('id="rct_1"', 'id="rct_173"', 'class="oj-ti-art"', 'oj-sti-art',
                   'oj-ti-section-1', 'considerando quanto segue'):
        assert marker in html, marker


def test_legacy_oj_fixture_is_class_less():
    html = _read("eprivacy_oj_legacy.html")
    assert "considerando quanto segue" in html
    assert "<p>(1) " in html
    assert "oj-ti-art" not in html and "title-article-norm" not in html


def test_consolidated_fixtures_use_norm_classes():
    for name in ("eprivacy_consolidated_20091219.html",
                 "eidas_consolidated_20241018_trimmed.html"):
        html = _read(name)
        assert "title-article-norm" in html, name
        assert "stitle-article-norm" in html, name
        assert 'class="modref"' in html, name
        assert "rct_" not in html, name  # consolidated texts have no preamble


def test_consolidated_eprivacy_has_a_suffixed_article():
    html = _read("eprivacy_consolidated_20091219.html")
    assert 'Articolo 14 <span class="norm">bis</span>' in html

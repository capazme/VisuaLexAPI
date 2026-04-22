"""Tests for contextual norm linking engine — real legal text samples."""

import pytest
from visualex_api.tools.citation_linker import extract_citations, Citation


class TestExplicitCitations:
    """AC: Explicit citations detected with full act reference."""

    def test_art_cc(self):
        text = "Si applica l'art. 2043 c.c."
        citations = extract_citations(text)
        assert len(citations) == 1
        c = citations[0]
        assert c.article == "2043"
        assert c.act_type == "codice civile"
        assert text[c.start:c.end] == "art. 2043 c.c."

    def test_art_cp(self):
        text = "come previsto dall'art. 575 c.p."
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].article == "575"
        assert citations[0].act_type == "codice penale"

    def test_dlgs_with_number_and_article(self):
        text = "ai sensi dell'art. 7 del d.lgs. 196/2003"
        citations = extract_citations(text)
        assert len(citations) == 1
        c = citations[0]
        assert c.article == "7"
        assert c.act_type == "decreto legislativo"
        assert c.act_number == "196"
        assert c.date == "2003"

    def test_legge_full_reference(self):
        text = "in base alla legge 241/1990, art. 1"
        citations = extract_citations(text)
        assert len(citations) >= 1
        # Should find at least the legge reference
        found = [c for c in citations if c.act_number == "241"]
        assert len(found) >= 1

    def test_art_cost(self):
        text = "L'art. 3 Cost. garantisce l'eguaglianza"
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].article == "3"
        assert citations[0].act_type == "costituzione"

    def test_art_cpc(self):
        text = "ai sensi dell'art. 100 c.p.c."
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].article == "100"
        assert citations[0].act_type == "codice di procedura civile"

    def test_bis_article(self):
        text = "Si veda l'art. 2-bis c.c."
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].article == "2-bis"

    def test_multiple_explicit_citations(self):
        text = "L'art. 2043 c.c. e l'art. 185 c.p. disciplinano il risarcimento"
        citations = extract_citations(text)
        assert len(citations) == 2
        articles = {c.article for c in citations}
        assert "2043" in articles
        assert "185" in articles

    def test_dpr_reference(self):
        text = "art. 31 d.p.r. 380/2001"
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].act_type == "decreto del presidente della repubblica"
        assert citations[0].act_number == "380"


class TestContextualCitations:
    """AC: Contextual citations resolve to current active norm context."""

    def test_bare_article_with_context(self):
        text = "Il codice civile disciplina i rapporti. L'art. 1 stabilisce le fonti."
        citations = extract_citations(text, context_act_type="codice civile")
        found = [c for c in citations if c.article == "1"]
        assert len(found) == 1
        assert found[0].act_type == "codice civile"

    def test_bare_article_uses_context(self):
        text = "L'art. 5 prevede..."
        citations = extract_citations(text, context_act_type="codice penale")
        assert len(citations) == 1
        assert citations[0].article == "5"
        assert citations[0].act_type == "codice penale"

    def test_explicit_overrides_context(self):
        text = "L'art. 2043 c.c. disciplina la responsabilità"
        citations = extract_citations(text, context_act_type="codice penale")
        assert len(citations) == 1
        assert citations[0].act_type == "codice civile"  # explicit wins

    def test_no_context_bare_article_still_detected(self):
        text = "L'art. 5 prevede..."
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].article == "5"
        assert citations[0].act_type is None  # no context, no act_type


class TestNormContextTracking:
    """AC: Maintains reference to last mentioned act across text."""

    def test_context_set_by_explicit_citation(self):
        text = (
            "L'art. 2043 c.c. prevede il risarcimento. "
            "L'art. 2059 disciplina il danno non patrimoniale."
        )
        citations = extract_citations(text)
        assert len(citations) == 2
        # Second article should inherit codice civile context
        assert citations[1].article == "2059"
        assert citations[1].act_type == "codice civile"

    def test_context_changes_with_new_act(self):
        text = (
            "L'art. 2043 c.c. prevede il risarcimento. "
            "L'art. 185 c.p. estende la tutela. "
            "L'art. 186 disciplina la restituzione."
        )
        citations = extract_citations(text)
        assert len(citations) == 3
        assert citations[0].act_type == "codice civile"
        assert citations[1].act_type == "codice penale"
        # Third should follow cp context
        assert citations[2].act_type == "codice penale"


class TestCitationMetadata:
    """AC: Output includes start/end positions and display text."""

    def test_start_end_positions(self):
        text = "Si veda l'art. 2043 c.c."
        citations = extract_citations(text)
        c = citations[0]
        assert c.start >= 0
        assert c.end > c.start
        assert c.end <= len(text)

    def test_display_text(self):
        text = "Si veda l'art. 2043 c.c."
        citations = extract_citations(text)
        c = citations[0]
        assert text[c.start:c.end] == c.display_text

    def test_to_dict(self):
        text = "art. 2043 c.c."
        citations = extract_citations(text)
        d = citations[0].to_dict()
        assert "start" in d
        assert "end" in d
        assert "article" in d
        assert "act_type" in d
        assert "display_text" in d

    def test_target_params(self):
        text = "art. 7 d.lgs. 196/2003"
        citations = extract_citations(text)
        params = citations[0].target_params()
        assert params["act_type"] == "decreto legislativo"
        assert params["article"] == "7"
        assert params["act_number"] == "196"
        assert params["date"] == "2003"


class TestEdgeCases:
    """AC: Handles edge cases."""

    def test_empty_text(self):
        assert extract_citations("") == []

    def test_no_citations(self):
        assert extract_citations("Questo testo non contiene riferimenti normativi.") == []

    def test_article_range(self):
        text = "artt. 1 e 2 c.c."
        citations = extract_citations(text)
        assert len(citations) >= 1

    def test_comma_article(self):
        text = "l'art. 2043, comma 1, c.c."
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].article == "2043"

    def test_multiple_norms_same_paragraph(self):
        text = (
            "Il danno è regolato dall'art. 2043 c.c., "
            "dall'art. 185 c.p. e dall'art. 2059 c.c."
        )
        citations = extract_citations(text)
        assert len(citations) == 3

    def test_act_number_slash_year(self):
        text = "d.lgs. 196/2003"
        citations = extract_citations(text)
        assert len(citations) == 1
        assert citations[0].act_type == "decreto legislativo"
        assert citations[0].act_number == "196"
        assert citations[0].date == "2003"
        assert citations[0].article is None

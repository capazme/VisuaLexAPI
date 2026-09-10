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


class TestEuCitations:
    """EU acts in article text: the official spelling carries the marker in
    parentheses and the pair year-first. The linker knew none of it."""

    def test_regolamento_ue_with_article_after(self):
        text = "ai sensi del regolamento (UE) 2016/679, art. 5, il titolare"
        c = extract_citations(text)
        assert len(c) == 1
        assert (c[0].act_type, c[0].act_number, c[0].date, c[0].article) == ("regolamento ue", "679", "2016", "5")
        assert text[c[0].start:c[0].end] == "regolamento (UE) 2016/679, art. 5"

    def test_cyber_resilience_act_year_first(self):
        c = extract_citations("il Regolamento (UE) 2024/2847 art. 13 impone")
        assert (c[0].act_type, c[0].act_number, c[0].date, c[0].article) == ("regolamento ue", "2847", "2024", "13")

    def test_article_before_eu_act(self):
        text = "l'art. 5 del regolamento (UE) 2016/679 prevede"
        c = extract_citations(text)
        assert len(c) == 1
        assert (c[0].act_type, c[0].act_number, c[0].date, c[0].article) == ("regolamento ue", "679", "2016", "5")
        assert text[c[0].start:c[0].end] == "art. 5 del regolamento (UE) 2016/679"

    def test_old_directive_trailing_marker(self):
        c = extract_citations("la direttiva 2002/58/CE, art. 5, dispone")
        assert (c[0].act_type, c[0].act_number, c[0].date, c[0].article) == ("direttiva ue", "58", "2002", "5")

    def test_implementing_regulation(self):
        c = extract_citations("regolamento di esecuzione (UE) 2015/2447, art. 3")
        assert (c[0].act_type, c[0].act_number, c[0].date, c[0].article) == ("regolamento ue", "2447", "2015", "3")

    def test_standalone_eu_act_sets_context_with_number_and_date(self):
        text = "Il regolamento (UE) 2016/679 si applica. L'art. 5 stabilisce i principi."
        c = extract_citations(text)
        assert len(c) == 2
        assert c[0].article is None
        assert (c[0].act_type, c[0].act_number, c[0].date) == ("regolamento ue", "679", "2016")
        assert (c[1].article, c[1].act_type, c[1].act_number, c[1].date) == ("5", "regolamento ue", "679", "2016")

    def test_national_regolamento_without_marker_is_not_eu(self):
        c = extract_citations("il regolamento n. 5/2020 art. 3 del consiglio comunale")
        assert all(x.act_type != "regolamento ue" for x in c)


class TestContextCarriesNumberAndDate:
    def test_bare_articles_inherit_the_act_number_and_year(self):
        text = "Ai sensi del d.lgs. 196/2003, l'art. 7 e l'art. 13 si applicano."
        arts = [x for x in extract_citations(text) if x.article]
        assert [(x.article, x.act_type, x.act_number, x.date) for x in arts] == [
            ("7", "decreto legislativo", "196", "2003"),
            ("13", "decreto legislativo", "196", "2003"),
        ]

    def test_a_new_act_resets_number_and_date(self):
        text = "Il d.lgs. 196/2003 rinvia. L'art. 2043 c.c. si applica. L'art. 2059 pure."
        last = extract_citations(text)[-1]
        assert (last.article, last.act_type, last.act_number, last.date) == ("2059", "codice civile", None, None)


class TestYearGroupHardening:
    def test_three_digit_second_half_is_not_a_year(self):
        c = extract_citations("come da legge 241/456 art. 3")
        assert not any(x.date for x in c)


class TestEuProseForms:
    """The forms Italian legal prose actually uses around an EU act."""

    def test_list_before_eu_act_belongs_to_that_act(self):
        text = "Si applica il d.lgs. 196/2003. Vedi anche gli articoli 8 e 9 del regolamento (UE) 2016/679."
        c = extract_citations(text)
        eu = {(x.article, x.act_number, x.date) for x in c if x.act_type == "regolamento ue"}
        assert {("8", "679", "2016"), ("9", "679", "2016")} <= eu
        assert not any(x.act_type == "decreto legislativo" and x.article in ("8", "9") for x in c)

    def test_list_after_eu_act_emits_one_citation_per_article(self):
        text = "regolamento (UE) 2016/679, articoli 8 e 9"
        c = extract_citations(text)
        arts = sorted((x.article, text[x.start:x.end]) for x in c if x.article)
        assert [a for a, _ in arts] == ["8", "9"]
        assert all(span.endswith(a) for a, span in arts)
        assert all((x.act_type, x.act_number, x.date) == ("regolamento ue", "679", "2016") for x in c)

    def test_comma_clause_closing_comma_before_del(self):
        text = "Il codice civile rileva. Vedi art. 5, comma 1, del regolamento (UE) 2016/679."
        art = [x for x in extract_citations(text, context_act_type="codice civile") if x.article == "5"]
        assert len(art) == 1
        assert (art[0].act_type, art[0].act_number, art[0].date) == ("regolamento ue", "679", "2016")

    def test_comma_clause_closing_comma_before_del_national(self):
        c = extract_citations("Vedi art. 5, comma 1, del d.lgs. 196/2003.")
        assert (c[0].article, c[0].act_type, c[0].act_number, c[0].date) == ("5", "decreto legislativo", "196", "2003")

    def test_comma_clause_closing_comma_before_abbreviation(self):
        c = extract_citations("l'art. 2, co. 3, c.p.")
        assert (c[0].article, c[0].act_type) == ("2", "codice penale")

    def test_single_article_keeps_the_whole_span(self):
        text = "gli articoli 8 e 9 del regolamento (UE) 2016/679 e l'art. 5 del regolamento (UE) 2016/679"
        five = [x for x in extract_citations(text) if x.article == "5"]
        assert text[five[0].start:five[0].end] == "art. 5 del regolamento (UE) 2016/679"


class TestAbbreviationBoundary:
    """An act abbreviation is a whole word: "comma" is not "com" (codice
    dell'ordinamento militare) and "costituzionalmente" is not "cost"."""

    def test_comma_clause_is_not_an_abbreviation(self):
        c = extract_citations("L'art. 5, comma 1, prevede l'obbligo.")
        assert [(x.article, x.act_type) for x in c] == [("5", None)]

    def test_comma_and_letter_before_cc(self):
        c = extract_citations("art. 3, comma 2, lettera a), c.c.")
        assert (c[0].article, c[0].act_type) == ("3", "codice civile")

    def test_comma_clause_does_not_poison_the_context(self):
        c = extract_citations("art. 1235, comma 2, e art. 7")
        assert all(x.act_type is None for x in c)

    def test_comma_letter_then_del(self):
        c = extract_citations("Vedi art. 5, comma 1, lett. b), del d.lgs. 196/2003.")
        assert (c[0].article, c[0].act_type, c[0].act_number, c[0].date) == ("5", "decreto legislativo", "196", "2003")

    def test_word_starting_with_an_abbreviation_is_not_the_act(self):
        c = extract_citations("l'art. 5 costituzionalmente orientato")
        assert (c[0].article, c[0].act_type) == ("5", None)

    def test_comma_clause_without_commas(self):
        c = extract_citations("art. 5 comma 1 cc")
        assert (c[0].article, c[0].act_type) == ("5", "codice civile")


class TestArticleRanges:
    def test_range_before_a_numbered_act(self):
        text = "Ai sensi del d.lgs. 196/2003, si applicano anche gli artt. 1-10 del d.lgs. 82/2005."
        ten = [x for x in extract_citations(text) if x.article == "1-10"]
        assert len(ten) == 1
        assert (ten[0].act_type, ten[0].act_number, ten[0].date) == ("decreto legislativo", "82", "2005")

    def test_range_after_an_eu_act(self):
        c = extract_citations("regolamento (UE) 2016/679, artt. 12-14")
        assert (c[0].article, c[0].act_number) == ("12-14", "679")


class TestTrailingMarkerRegulation:
    def test_regulation_with_trailing_marker_counts_as_marked(self):
        c = extract_citations("il regolamento 1049/2001/CE, art. 4, prevede")
        assert (c[0].act_type, c[0].act_number, c[0].date, c[0].article) == ("regolamento ue", "1049", "2001", "4")


class TestLongLists:
    def test_a_long_list_stays_fast(self):
        import time
        text = "artt. " + " e ".join(["1"] * 25_000) + " del regolamento (UE) 2016/679"
        assert len(text) > 100_000
        started = time.perf_counter()
        c = extract_citations(text)
        assert time.perf_counter() - started < 3.0
        assert len(c) > 1


class TestContextNeedsANumber:
    """An act that needs a number ("legge") but came out without one cannot be
    opened, so it must not take over the context of the bare articles after it."""

    def test_numberless_act_does_not_take_the_context(self):
        text = ("Ai sensi dell'art. 2043 c.c. il danno è risarcibile. Come previsto dall'art. 17, "
                "comma 1, della legge 23 agosto 1988, n. 400, si veda anche l'art. 2059 e l'art. 1218.")
        c = {x.article: x for x in extract_citations(text)}
        assert (c["2059"].act_type, c["1218"].act_type) == ("codice civile", "codice civile")

    def test_apostrophe_does_not_end_an_abbreviation(self):
        c = extract_citations("art. 5 com'era previsto")
        assert (c[0].article, c[0].act_type) == ("5", None)

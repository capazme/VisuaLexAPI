import pytest

from visualex_api.services.case_law.italgiure import ItalgiureAdapter, build_norma_query

SOLR_JSON = """{"response":{"numFound":1594,"docs":[
 {"numdec":"28469","anno":"2024","szdec":"3"},
 {"numdec":"16056","anno":"2023","szdec":"3"}]}}"""


def test_the_query_never_drops_the_code():
    """The source repo's variant builder emits a bare "art. 2043", so a
    decision citing art. 2043 c.p.c. lands in the results for art. 2043 c.c.
    Every variant here keeps the code."""
    q = build_norma_query("art. 2043 c.c.")
    assert '"art. 2043 c.c."' in q or '"2043 c.c."' in q
    assert '"art. 2043"' not in q


def test_the_query_survives_suffixes_past_decies():
    """Normattiva goes well past `decies` — 2409 octiesdecies exists. An
    enumerated suffix list is the bug fixed twice already (gotcha 9)."""
    q = build_norma_query("art. 2409-octiesdecies c.c.")
    assert "2409-octiesdecies" in q


def test_the_query_does_not_swallow_a_single_letter_abbreviation():
    """A greedy `[a-z]+` tail treats the "c" of "c.c." as if it were an
    ordinal suffix like "bis", capturing "2043 c" as the article number and
    leaving only ".c." as the act text — which then fails to build any of
    the expected variants at all. Every real Italian ordinal suffix is at
    least three letters, so the abbreviation must never be absorbed."""
    q = build_norma_query("art. 2043 c.p.c.")
    assert '"art. 2043 c.p.c."' in q or '"2043 c.p.c."' in q
    assert '"art. 2043"' not in q


def test_the_act_can_precede_the_article_number():
    """"codice civile art. 2043" names the act before the number. A builder
    that only looks at the text after the match silently drops it and falls
    through to the unsafe bare-article branch."""
    q = build_norma_query("codice civile art. 2043")
    assert "codice civile" in q
    assert '"art. 2043"' not in q


def test_mixed_case_still_keeps_the_act():
    q = build_norma_query("ART. 2043 C.C.")
    assert '"art. 2043 C.C."' in q
    assert '"art. 2043"' not in q


def test_no_act_at_all_never_synthesises_a_bare_article_clause():
    """With no act on either side, there is nothing safe to embed. The raw
    reference is searched verbatim rather than through the
    f'"art. {numero}"' template — the exact shape of the bug this function
    exists to avoid."""
    q = build_norma_query("art. 2043")
    assert q == 'ocr:("art. 2043")'


async def test_parses_decisions_and_marks_them_matched(monkeypatch):
    adapter = ItalgiureAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = SOLR_JSON
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.http_client.request", fake_request
    )
    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.italgiure_ssl_context",
        _fake_ctx,
    )
    result = await adapter.cerca_per_norma("art. 2043 c.c.")

    assert result.ok is True
    assert [d.numero for d in result.decisioni] == ["28469", "16056"]
    # A string match in the decision text is an inference, not a declaration.
    assert all(d.link_kind.value == "matched" for d in result.decisioni)
    assert result.coverage == "ultimi 5 anni"


async def _fake_ctx():
    return None


async def test_failure_is_reported(monkeypatch):
    adapter = ItalgiureAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("gateway timeout")

    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.http_client.request", boom
    )
    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.italgiure_ssl_context", _fake_ctx
    )
    result = await adapter.cerca_per_norma("art. 2043 c.c.")
    assert result.ok is False
    assert "gateway timeout" in result.error


async def test_datdep_is_unwrapped_from_a_solr_multivalued_field(monkeypatch):
    """Measured live: `datdep` comes back as a single-element JSON array even
    though it only ever holds one value. `str()` on that list would store
    the Python repr ("['20250702']") instead of the date."""
    adapter = ItalgiureAdapter()
    payload = ('{"response":{"numFound":1,"docs":['
               '{"numdec":"1","anno":"2024","szdec":"1","datdep":["20240102"]}]}}')

    async def fake_request(method, url, **kwargs):
        class R:
            text = payload
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.http_client.request", fake_request
    )
    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.italgiure_ssl_context", _fake_ctx
    )
    result = await adapter.cerca_per_norma("art. 2043 c.c.")
    assert result.decisioni[0].data == "20240102"


async def test_leggi_returns_none_when_nothing_is_found(monkeypatch):
    """`leggi()` must never fabricate a decision for a number/year pair that
    Solr didn't actually return — an earlier adapter in this plan shipped
    exactly that defect."""
    adapter = ItalgiureAdapter()
    empty = '{"response":{"numFound":0,"docs":[]}}'

    async def fake_request(method, url, **kwargs):
        class R:
            text = empty
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.http_client.request", fake_request
    )
    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.italgiure_ssl_context", _fake_ctx
    )
    result = await adapter.leggi("999999", 2024)
    assert result is None


@pytest.mark.live
async def test_italgiure_answers_for_art_2043():
    result = await ItalgiureAdapter().cerca_per_norma("art. 2043 c.c.", limite=3)
    assert result.ok is True, result.error
    assert len(result.decisioni) > 0

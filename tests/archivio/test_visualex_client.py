"""The client of the local VisuaLex API, against the scripted fake.

What matters: the request vocabulary (act_type/date/act_number/annex/article)
and the response vocabulary (norma_data in Italian) are mapped explicitly;
429/5xx/timeouts are retried, 4xx are not; a missing article in the stream
comes back as "not returned", never as a crash.
"""
import pytest

from archivio_normativo.manifest import ActSpec
from archivio_normativo.sources.visualex import (
    FingerprintsResult, VisuaLexClient, VisuaLexError, select_fingerprints,
)
from archivio_normativo.throttle import Throttle

CC_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"
GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"


def cc_spec(**kw):
    base = dict(id="cc", area="civile", label="Codice civile", source="normattiva",
                act_type="codice civile", cite="c.c.")
    base.update(kw)
    return ActSpec(**base)


def gdpr_spec(**kw):
    base = dict(id="gdpr", area="ue", label="GDPR", source="eurlex", act_type="regolamento ue",
                date="2016", act_number="679", celex="32016R0679", units=("articles", "recitals"), cite="GDPR")
    base.update(kw)
    return ActSpec(**base)


@pytest.fixture
def cc(fake_visualex):
    return fake_visualex.add_act(
        act_type="codice civile", url=CC_URL, annex="2",
        tree=["LIBRO QUARTO Delle obbligazioni", {"numero": "2043", "allegato": "2"},
              {"numero": "2044", "allegato": "2"}, {"numero": "2 bis", "allegato": "2"}],
        annexes=[{"number": None, "label": "Dispositivo", "article_count": 0, "article_numbers": []},
                 {"number": "2", "label": "CODICE CIVILE", "article_count": 3, "article_numbers": ["2043", "2044", "2 bis"]}],
        rubriche={"2043": "Risarcimento per fatto illecito"}, abrogati=[],
        fingerprints={"2043": {"fingerprint": "a" * 64, "date": "1942-04-21"}, "2044": {"fingerprint": "b" * 64, "date": None}},
        articles={"2043": "Qualunque fatto…", "2044": {"error": "ParsingError: selector"}, "2-bis": "Testo del 2-bis"},
        brocardi={"2043": {"Ratio": "…", "Massime": ["m1"]}},
    )


@pytest.fixture
def client(fake_visualex, session, throttle):
    return VisuaLexClient(fake_visualex.base_url, session, throttle, sleep=_no_sleep, jitter=lambda: 0.5)


async def _no_sleep(_seconds):
    return None


class TestResolve:
    async def test_resolve_act_reads_the_act_url_and_effective_annex(self, client, cc, fake_visualex):
        res = await client.resolve_act(cc_spec())
        assert res.act_url == CC_URL
        assert res.annex == "2"
        assert res.tipo_atto == "codice civile"
        path, body = fake_visualex.calls[-1]
        assert path == "/fetch_norma_data"
        assert body["article"] == "1" and body["act_type"] == "codice civile"
        assert "date" not in body and "annex" not in body

    async def test_resolve_sends_date_number_annex_and_consolidated(self, client, fake_visualex):
        fake_visualex.add_act(act_type="direttiva ue", date="2002", act_number="58",
                              celex_consolidated="02002L0058-20091219",
                              url="https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219")
        spec = ActSpec(id="eprivacy", area="ue", label="e-privacy", source="eurlex", act_type="direttiva ue",
                       date="2002", act_number="58", celex="32002L0058", celex_consolidated="02002L0058-20091219",
                       units=("articles", "recitals"), cite="dir. 2002/58/CE", annex=None)
        res = await client.resolve_act(spec)
        assert "02002L0058-20091219" in res.act_url
        body = fake_visualex.calls[-1][1]
        assert body["date"] == "2002" and body["act_number"] == "58"
        assert body["celex_consolidated"] == "02002L0058-20091219"

    async def test_unknown_act_is_a_visualex_error_with_status(self, client):
        with pytest.raises(VisuaLexError) as info:
            await client.resolve_act(cc_spec(act_type="codice inesistente"))
        assert info.value.status == 404
        assert "non presente" in str(info.value)


class TestStructure:
    async def test_tree(self, client, cc):
        tree = await client.fetch_tree(CC_URL)
        assert tree.count == 3
        assert tree.items[0] == "LIBRO QUARTO Delle obbligazioni"
        assert tree.annexes[1]["number"] == "2"

    async def test_rubriche(self, client, cc):
        r = await client.fetch_rubriche(CC_URL)
        assert r.rubriche == {"2043": "Risarcimento per fatto illecito"}
        assert r.abrogati == []

    async def test_fingerprints_available(self, client, cc):
        fp = await client.fetch_fingerprints(CC_URL)
        assert fp.available is True
        assert fp.fingerprints["2043"]["date"] == "1942-04-21"

    async def test_fingerprints_unavailable(self, client, fake_visualex):
        fake_visualex.add_act(act_type="legge", date="1990-08-07", act_number="241",
                              url="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241",
                              fingerprints=None)
        fp = await client.fetch_fingerprints("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241")
        assert fp.available is False and fp.fingerprints == {}

    async def test_recitals(self, client, fake_visualex):
        fake_visualex.add_act(act_type="regolamento ue", date="2016", act_number="679", url=GDPR_URL,
                              recitals=[{"number": "1", "text": "La protezione…"}])
        recitals = await client.fetch_recitals(gdpr_spec())
        assert [(r.number, r.text) for r in recitals] == [("1", "La protezione…")]


class TestStream:
    async def test_texts_errors_and_missing_articles(self, client, cc, fake_visualex):
        results = await client.stream_articles(cc_spec(), ["2043", "2044", "2-bis", "9999"], annex="2", brocardi=True)
        by_number = {r.number: r for r in results}
        assert set(by_number) == {"2043", "2044", "2-bis"}, "9999 is not in the act: omitted, not invented"
        assert by_number["2043"].text == "Qualunque fatto…"
        assert by_number["2043"].urn.endswith(":2~art2043")
        assert by_number["2043"].annex == "2"
        assert by_number["2043"].brocardi == {"Ratio": "…", "Massime": ["m1"]}
        assert by_number["2044"].error == "ParsingError: selector" and by_number["2044"].text is None
        assert by_number["2-bis"].raw_number == "2-bis"
        body = fake_visualex.calls[-1][1]
        assert body["article"] == "2043,2044,2-bis,9999"
        assert body["annex"] == "2" and body["show_brocardi_info"] is True

    async def test_pacing_counts_articles_not_requests(self, fake_visualex, session, cc):
        paced = []

        class Recording(Throttle):
            async def pace(self, tokens):
                paced.append(tokens)

        client = VisuaLexClient(fake_visualex.base_url, session, Recording(1.0), sleep=_no_sleep)
        await client.stream_articles(cc_spec(), ["2043", "2044"], annex="2", brocardi=False)
        assert paced == [2]


class TestRetries:
    async def test_5xx_then_success_is_retried(self, client, cc, fake_visualex):
        fake_visualex.fail["/fetch_tree"] = [503, 502]
        tree = await client.fetch_tree(CC_URL)
        assert tree.count == 3
        assert sum(1 for p, _ in fake_visualex.calls if p == "/fetch_tree") == 3

    async def test_429_is_retried(self, client, cc, fake_visualex):
        fake_visualex.fail["/fetch_rubriche"] = [429]
        r = await client.fetch_rubriche(CC_URL)
        assert "2043" in r.rubriche

    async def test_4xx_is_not_retried(self, client, cc, fake_visualex):
        fake_visualex.fail["/fetch_tree"] = [400]
        with pytest.raises(VisuaLexError) as info:
            await client.fetch_tree(CC_URL)
        assert info.value.status == 400
        assert sum(1 for p, _ in fake_visualex.calls if p == "/fetch_tree") == 1

    async def test_gives_up_after_attempts(self, fake_visualex, session, throttle, cc):
        fake_visualex.fail["/fetch_tree"] = [500] * 10
        client = VisuaLexClient(fake_visualex.base_url, session, throttle, attempts=3, sleep=_no_sleep)
        with pytest.raises(VisuaLexError) as info:
            await client.fetch_tree(CC_URL)
        assert info.value.status == 500
        assert sum(1 for p, _ in fake_visualex.calls if p == "/fetch_tree") == 3


class TestSelectFingerprints:
    def test_picks_the_map_that_overlaps_most(self):
        result = FingerprintsResult(
            available=True,
            fingerprints={"1": {"fingerprint": "c1", "date": None}, "2": {"fingerprint": "c2", "date": None}},
            parts=[{"name": "Disposizioni sulla legge in generale",
                    "fingerprints": {"1": {"fingerprint": "p1", "date": None}, "31": {"fingerprint": "p31", "date": None}}}],
        )
        assert select_fingerprints(result, ["1", "31"])["1"]["fingerprint"] == "p1"
        assert select_fingerprints(result, ["1", "2"])["2"]["fingerprint"] == "c2"

    def test_no_overlap_means_nothing(self):
        result = FingerprintsResult(True, {"1": {"fingerprint": "x", "date": None}}, [])
        assert select_fingerprints(result, ["500"]) == {}
        assert select_fingerprints(FingerprintsResult(False, {}, []), ["1"]) == {}

    def test_keys_are_normalised(self):
        result = FingerprintsResult(True, {"2 bis": {"fingerprint": "x", "date": None}}, [])
        assert select_fingerprints(result, ["2-bis"]) == {"2-bis": {"fingerprint": "x", "date": None}}

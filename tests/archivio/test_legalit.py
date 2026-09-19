"""The enrichment provider: legal-it tools over MCP stdio.

The SDK is never imported here — a fake session stands in — so the suite
runs without the `mcp` package, which is optional for the archive itself.
"""
import asyncio
import sys
from contextlib import asynccontextmanager
from types import ModuleType, SimpleNamespace

import pytest

from archivio_normativo.manifest import ActSpec
from archivio_normativo.sources.legalit import (
    LegalItClient, LegalItError, LegalItTransportError, ToolCall, act_calls, classify_result, reference_for,
    unit_calls,
)
from archivio_normativo.throttle import Throttle


def spec(**kw):
    base = dict(id="dlgs-231-2001", area="penale", label="D.Lgs. 231/2001", source="normattiva",
                act_type="decreto legislativo", date="2001-06-08", act_number="231", cite="D.Lgs. 231/2001")
    base.update(kw)
    return ActSpec(**base)


def eu_spec(**kw):
    base = dict(id="nis2", area="ue", label="NIS2", source="eurlex", act_type="direttiva ue",
                date="2022", act_number="2555", celex="32022L2555", units=("articles", "recitals"),
                cite="dir. (UE) 2022/2555")
    base.update(kw)
    return ActSpec(**base)


class TestCallBuilders:
    def test_reference_keeps_the_suffix_hyphenated(self):
        assert reference_for(spec(), "6") == "art. 6 D.Lgs. 231/2001"
        assert reference_for(spec(cite="c.c."), "2-bis") == "art. 2-bis c.c."

    @pytest.mark.parametrize("kind, tool, key", [
        ("cassazione", "giurisprudenza_su_norma", "riferimento"),
        ("cassazione_massime", "giurisprudenza_articolo", "riferimento"),
        ("amministrativa", "giurisprudenza_amm_su_norma", "riferimento"),
        ("tributaria", "cerca_giurisprudenza_tributaria", "query"),
        ("cgue", "giurisprudenza_cgue_su_norma", "riferimento"),
        ("costituzionale", "pronunce_cost_su_norma", "riferimento"),
        ("garante", "cerca_provvedimenti_garante", "query"),
    ])
    def test_unit_kinds_map_to_one_tool_with_the_reference(self, kind, tool, key):
        calls = unit_calls(kind, spec(), "6")
        assert len(calls) == 1
        assert calls[0].tool == tool
        assert calls[0].args[key] == "art. 6 D.Lgs. 231/2001"
        assert "max_risultati" in calls[0].args

    def test_attuazione_is_two_calls_on_the_celex(self):
        calls = act_calls("attuazione", eu_spec())
        assert [c.tool for c in calls] == ["get_italian_implementation", "elenco_misure_nazionali"]
        assert calls[0].args == {"direttiva": "32022L2555"}
        assert calls[1].args == {"direttiva": "32022L2555", "paese": "ITA"}

    def test_base_ue_uses_the_citation(self):
        assert act_calls("base_ue", spec()) == [ToolCall("get_eu_basis", {"atto": "D.Lgs. 231/2001"})]

    def test_wrong_level_or_brocardi_is_an_error(self):
        with pytest.raises(ValueError):
            unit_calls("attuazione", eu_spec(), "1")
        with pytest.raises(ValueError):
            act_calls("cassazione", spec())
        with pytest.raises(ValueError):
            unit_calls("brocardi", spec(), "6")


class TestClassify:
    def test_shapes(self):
        assert classify_result("**Errore**: italgiure non raggiungibile.") == "error"
        assert classify_result("Nessun risultato su italgiure.") == "empty"
        assert classify_result("") == "empty"
        assert classify_result("## Sentenze\n- Cass. civ. 123/2024 …") == "ok"

    def test_other_no_hits_phrasings_are_also_empty(self):
        assert classify_result("Nessuna pronuncia trovata.") == "empty"
        assert classify_result("Nessun provvedimento trovato per la query indicata.") == "empty"
        assert classify_result("Nessuno trovato.") == "empty"
        assert classify_result("**Nessun provvedimento trovato**") == "empty"
        # Ordinary text mentioning "trovato" outside that shape stays "ok".
        assert classify_result("## Risultati\nAbbiamo trovato 3 provvedimenti rilevanti.") == "ok"

    def test_no_hits_phrasing_mid_sentence_does_not_shadow_a_real_result(self):
        """`_NO_HITS_RE` must only match at the start of a line.

        "Nessun nesso causale è stato trovato dal giudice" inside a real
        result used to match the unanchored pattern anywhere in the first 200
        characters and get classified "empty".
        """
        assert classify_result(
            "## Sentenze\n- Cass. civ. 123/2024: nessun nesso causale è stato "
            "trovato dal giudice tra la condotta e l'evento."
        ) == "ok"


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.timeouts = []

    async def call_tool(self, name, arguments, read_timeout_seconds=None):
        self.calls.append((name, arguments))
        self.timeouts.append(read_timeout_seconds)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(isError=False, content=[SimpleNamespace(type="text", text=item)])


def factory_for(session):
    @asynccontextmanager
    async def factory():
        yield session
    return factory


async def _no_sleep(_):
    return None


class TestClient:
    async def test_call_returns_the_text_content(self):
        session = FakeSession(["## Sentenze…"])
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session)) as client:
            text = await client.call(ToolCall("giurisprudenza_su_norma", {"riferimento": "art. 6 D.Lgs. 231/2001"}))
        assert text == "## Sentenze…"
        assert session.calls == [("giurisprudenza_su_norma", {"riferimento": "art. 6 D.Lgs. 231/2001"})]

    async def test_transport_errors_are_retried(self):
        session = FakeSession([ConnectionError("pipe"), "ok"])
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session),
                                 sleep=_no_sleep, jitter=lambda: 0.5) as client:
            assert await client.call(ToolCall("t", {})) == "ok"
        assert len(session.calls) == 2

    async def test_a_tool_error_result_is_a_legalit_error(self):
        class ErrSession:
            async def call_tool(self, name, arguments, read_timeout_seconds=None):
                return SimpleNamespace(isError=True, content=[SimpleNamespace(type="text", text="boom")])

        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(ErrSession())) as client:
            with pytest.raises(LegalItError, match="boom"):
                await client.call(ToolCall("t", {}))

    async def test_calls_are_paced(self):
        paced = []

        class Recording(Throttle):
            async def acquire(self):
                paced.append(1)

        session = FakeSession(["a", "b"])
        async with LegalItClient(("bash", "x.sh"), Recording(0), session_factory=factory_for(session)) as client:
            await client.call(ToolCall("t", {}))
            await client.call(ToolCall("t", {}))
        assert paced == [1, 1]

    async def test_missing_sdk_is_a_clear_error(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "mcp", None)  # makes `import mcp` raise ImportError
        with pytest.raises(LegalItError, match="requirements-archivio.txt"):
            async with LegalItClient(("bash", "x.sh"), Throttle(0)):
                pass

    async def test_an_empty_command_is_refused(self):
        with pytest.raises(LegalItError, match="command"):
            async with LegalItClient((), Throttle(0)):
                pass


class TestTimeouts:
    """A hung legal-it call must not hang the run: the client bounds every
    tool call and the handshake, and a timeout is a retryable transport error."""

    async def test_a_hung_call_times_out_as_a_transport_error(self):
        class HangingSession:
            def __init__(self):
                self.calls = 0

            async def call_tool(self, name, arguments, read_timeout_seconds=None):
                self.calls += 1
                await asyncio.Event().wait()  # never set: the server never answers

        session = HangingSession()
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session),
                                 attempts=2, sleep=_no_sleep, jitter=lambda: 0.5, call_timeout=0.05) as client:
            with pytest.raises(LegalItTransportError, match="timed out"):
                await client.call(ToolCall("giurisprudenza_su_norma", {"riferimento": "art. 6"}))
        assert session.calls == 2, "the timeout is retried like any other transport error, then given up"

    async def test_the_call_timeout_is_handed_to_the_sdk(self):
        session = FakeSession(["ok"])
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session),
                                 call_timeout=7.5) as client:
            await client.call(ToolCall("t", {}))
        assert session.timeouts == [7.5]

    async def test_the_default_call_timeout_is_two_minutes(self):
        session = FakeSession(["ok"])
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session)) as client:
            await client.call(ToolCall("t", {}))
        assert session.timeouts == [120.0]

    async def test_the_sdks_own_error_is_a_transport_error(self):
        """mcp 2.x's `MCPError` (a request timeout, a closed stream) is a
        transport failure worth a retry, matched by name so the SDK stays optional."""
        exc_type = type("MCPError", (Exception,), {})
        session = FakeSession([exc_type("request timed out"), "ok"])
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session),
                                 sleep=_no_sleep, jitter=lambda: 0.5) as client:
            assert await client.call(ToolCall("t", {})) == "ok"
        assert len(session.calls) == 2

    async def test_a_hung_handshake_is_a_clear_error(self, monkeypatch):
        """`initialize()` is bounded too: the first start builds a venv through
        uv and a server that never answers must not hang `build` forever.
        Exercised through the default factory with a stand-in `mcp` package."""
        class HangingClientSession:
            def __init__(self, read, write):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return None

            async def initialize(self):
                await asyncio.Event().wait()

        @asynccontextmanager
        async def stdio_client(params):
            yield (None, None)

        fake_mcp = ModuleType("mcp")
        fake_mcp.ClientSession = HangingClientSession
        fake_mcp.StdioServerParameters = lambda command, args: SimpleNamespace(command=command, args=args)
        fake_stdio = ModuleType("mcp.client.stdio")
        fake_stdio.stdio_client = stdio_client
        fake_client = ModuleType("mcp.client")
        monkeypatch.setitem(sys.modules, "mcp", fake_mcp)
        monkeypatch.setitem(sys.modules, "mcp.client", fake_client)
        monkeypatch.setitem(sys.modules, "mcp.client.stdio", fake_stdio)
        with pytest.raises(LegalItError, match=r"initialize.*0\.05"):
            async with LegalItClient(("bash", "x.sh"), Throttle(0), start_timeout=0.05):
                pass

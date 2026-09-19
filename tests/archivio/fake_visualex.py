"""A scripted stand-in for the six VisuaLex endpoints the archive uses.

Shapes mirror the real API (root `app.py`): `norma_data` speaks Italian
(`tipo_atto`, `numero_articolo`, `allegato`, `urn`, `url`), the stream is
NDJSON and silently omits articles the act does not have, `fetch_rubriche`
and `fetch_act_fingerprints` always answer 200.
"""
from __future__ import annotations

import json

from aiohttp import web
from aiohttp.test_utils import TestServer


class FakeVisuaLex:
    def __init__(self):
        self.acts: dict[str, dict] = {}
        self.calls: list[tuple[str, dict]] = []
        self.fail: dict[str, list[int]] = {}
        self._server: TestServer | None = None

    @staticmethod
    def key(act_type, date=None, act_number=None, celex_consolidated=None) -> str:
        return "|".join(str(x or "").strip().lower() for x in (act_type, date, act_number, celex_consolidated))

    def add_act(self, *, act_type, date=None, act_number=None, celex_consolidated=None, url, annex=None,
                tree=(), annexes=None, rubriche=None, abrogati=(), fingerprints=None, recitals=(),
                articles=None, brocardi=None) -> dict:
        scenario = {
            "act_type": act_type, "date": date, "act_number": act_number,
            "celex_consolidated": celex_consolidated, "url": url, "annex": annex,
            "tree": list(tree), "annexes": annexes or [], "rubriche": rubriche or {},
            "abrogati": list(abrogati), "fingerprints": fingerprints, "recitals": list(recitals),
            "articles": dict(articles or {}), "brocardi": dict(brocardi or {}),
        }
        self.acts[self.key(act_type, date, act_number, celex_consolidated)] = scenario
        return scenario

    def _by_url(self, url: str) -> dict | None:
        url = str(url).split("~")[0]
        return next((s for s in self.acts.values() if s["url"] == url), None)

    def _scenario(self, body: dict) -> dict | None:
        return self.acts.get(self.key(body.get("act_type"), body.get("date"), body.get("act_number"),
                                      body.get("celex_consolidated")))

    async def _guard(self, request) -> tuple[dict, web.Response | None]:
        body = await request.json()
        self.calls.append((request.path, body))
        queue = self.fail.get(request.path) or []
        if queue:
            status = queue.pop(0)
            return body, web.json_response({"error": f"simulated {status}"}, status=status)
        return body, None

    @staticmethod
    def _norma_data(s: dict, number: str, annex) -> dict:
        data = {
            "tipo_atto": s["act_type"], "data": s["date"], "numero_atto": s["act_number"],
            "url": s["url"], "allegato": annex, "numero_articolo": number, "versione": "vigente",
            "data_versione": None, "urn": f"{s['url']}{':' + str(annex) if annex else ''}~art{number.replace('-', '')}",
        }
        if s["celex_consolidated"]:
            data["celex_consolidated"] = s["celex_consolidated"]
        return data

    async def fetch_norma_data(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._scenario(body)
        if s is None:
            return web.json_response({"error": f"Articolo {body.get('article')} non presente in {body.get('act_type')}"}, status=404)
        annex = body.get("annex") if body.get("annex") not in (None, "") else s["annex"]
        return web.json_response({"norma_data": [self._norma_data(s, str(body.get("article")), annex)]})

    async def fetch_tree(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._by_url(body.get("urn", ""))
        if s is None:
            return web.json_response({"error": "Div with id 'albero' not found"}, status=500)
        count = sum(1 for item in s["tree"] if isinstance(item, dict))
        return web.json_response({"articles": s["tree"], "count": count, "metadata": {"annexes": s["annexes"]}})

    async def fetch_rubriche(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._by_url(body.get("urn", ""))
        if s is None:
            return web.json_response({"rubriche": {}, "abrogati": [], "parts": [], "count": 0})
        return web.json_response({"rubriche": s["rubriche"], "abrogati": s["abrogati"], "parts": [],
                                  "count": len(s["rubriche"])})

    async def fetch_act_fingerprints(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        if "eur-lex" in str(body.get("urn", "")):
            return web.json_response({"error": "fetch_act_fingerprints accetta solo atti Normattiva"}, status=400)
        s = self._by_url(body.get("urn", ""))
        if s is None or s["fingerprints"] is None:
            return web.json_response({"available": False, "fingerprints": {}, "parts": [], "count": 0})
        fp = s["fingerprints"]
        if isinstance(fp, dict) and "parts" in fp:
            return web.json_response({"available": True, "fingerprints": fp.get("fingerprints", {}),
                                      "parts": fp["parts"], "count": len(fp.get("fingerprints", {}))})
        return web.json_response({"available": True, "fingerprints": fp, "parts": [], "count": len(fp)})

    async def fetch_recitals(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        if str(body.get("act_type", "")).lower() not in ("regolamento ue", "direttiva ue"):
            return web.json_response({"error": "fetch_recitals accetta solo atti EUR-Lex"}, status=400)
        s = self._scenario({**body, "celex_consolidated": None})
        if s is None:
            return web.json_response({"error": "EUR-Lex is down"}, status=500)
        return web.json_response({"recitals": s["recitals"], "count": len(s["recitals"]), "url": s["url"]})

    async def stream_article_text(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._scenario(body)
        if s is None:
            return web.json_response({"error": f"Articolo non presente in {body.get('act_type')}"}, status=404)
        annex = body.get("annex") if body.get("annex") not in (None, "") else s["annex"]
        lines = []
        for raw in str(body.get("article", "")).split(","):
            number = raw.strip().lower().replace(" ", "-")
            if number not in s["articles"]:
                continue  # the real API drops articles the act does not have
            entry = s["articles"][number]
            norma_data = self._norma_data(s, number, annex)
            if isinstance(entry, dict) and "error" in entry:
                lines.append({"error": entry["error"], "norma_data": norma_data})
                continue
            line = {"article_text": entry, "norma_data": norma_data, "url": norma_data["urn"]}
            if body.get("show_brocardi_info") and number in s["brocardi"]:
                line["brocardi_info"] = s["brocardi"][number]
            lines.append(line)
        payload = "".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines)
        return web.Response(text=payload, content_type="application/x-ndjson")

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/fetch_norma_data", self.fetch_norma_data)
        app.router.add_post("/fetch_tree", self.fetch_tree)
        app.router.add_post("/fetch_rubriche", self.fetch_rubriche)
        app.router.add_post("/fetch_act_fingerprints", self.fetch_act_fingerprints)
        app.router.add_post("/fetch_recitals", self.fetch_recitals)
        app.router.add_post("/stream_article_text", self.stream_article_text)
        return app

    async def start(self) -> str:
        self._server = TestServer(self.app())
        await self._server.start_server()
        return str(self._server.make_url("")).rstrip("/")

    async def stop(self) -> None:
        if self._server is not None:
            await self._server.close()
            self._server = None

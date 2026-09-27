"""aiohttp client wrapper: auth, assertions, NDJSON, multipart, polling.

One ApiClient per identity (admin / user_a / user_b / stress VU). Every
request records latency into the shared Report under the current flow/step.
On status mismatch it raises StepFailure with a full request/response dump
(unless record_only=True, used by stress.py).
"""
from __future__ import annotations

import asyncio
import json as jsonlib
import time
from pathlib import Path
from typing import Any, Callable, Awaitable

import aiohttp

from .config import Config
from .report import Report, StepFailure


class ApiClient:
    def __init__(self, cfg: Config, report: Report, identity: str = "anon",
                 record_only: bool = False):
        self.cfg = cfg
        self.report = report
        self.identity = identity
        self.record_only = record_only
        self.access_token: str = ""
        self.refresh_token: str = ""
        self.user_id: str = ""
        self._session: aiohttp.ClientSession | None = None

    # ---- lifecycle ----
    async def start(self) -> None:
        if self._session is None:
            self._session = aiohttp.ClientSession()

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> "ApiClient":
        await self.start()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    # ---- core request ----
    async def req(
        self,
        method: str,
        url: str,
        *,
        json: Any = None,
        data: Any = None,
        headers: dict[str, str] | None = None,
        expect: int | tuple[int, ...] | None = 200,
        timeout: float | None = None,
        auth: bool = True,
    ) -> tuple[int, Any]:
        """Returns (status, parsed_body). Body is JSON-parsed when possible,
        raw bytes for binary responses, text otherwise."""
        assert self._session is not None, "call start() first"
        hdrs = dict(headers or {})
        if auth and self.access_token and "Authorization" not in hdrs:
            hdrs["Authorization"] = f"Bearer {self.access_token}"
        t0 = time.monotonic()
        status: int | None = None
        body: Any = None
        detail = ""
        try:
            async with self._session.request(
                method,
                url,
                json=json,
                data=data,
                headers=hdrs,
                timeout=aiohttp.ClientTimeout(total=timeout or self.cfg.default_timeout),
            ) as resp:
                status = resp.status
                ctype = resp.headers.get("Content-Type", "")
                if "application/json" in ctype:
                    body = await resp.json(content_type=None)
                elif ctype.startswith(("application/pdf", "application/octet-stream", "image/")):
                    body = await resp.read()
                else:
                    text = await resp.text()
                    try:
                        body = jsonlib.loads(text)
                    except (ValueError, TypeError):
                        body = text
        except asyncio.TimeoutError:
            detail = f"timeout after {timeout or self.cfg.default_timeout}s"
        except aiohttp.ClientError as e:
            detail = f"connection error: {e!r}"
        latency = (time.monotonic() - t0) * 1000

        expected = (expect,) if isinstance(expect, int) else expect
        ok = detail == "" and (expected is None or status in expected)
        if not ok and not detail:
            detail = f"expected {expected}, got {status}"
        self.report.record(method, url, status, latency, ok, detail)

        if not ok and not self.record_only:
            dump = {
                "identity": self.identity,
                "request": {"method": method, "url": url, "json": json},
                "response": {"status": status, "body": _truncate(body)},
            }
            raise StepFailure(f"{method} {url} -> {status or detail}", dump)
        return status or 0, body

    # ---- NDJSON streaming (Python API /stream_article_text) ----
    async def req_ndjson(self, url: str, *, json: Any,
                         timeout: float | None = None) -> list[dict]:
        assert self._session is not None
        hdrs: dict[str, str] = {}
        if self.access_token:
            hdrs["Authorization"] = f"Bearer {self.access_token}"
        t0 = time.monotonic()
        lines: list[dict] = []
        try:
            async with self._session.post(
                url, json=json, headers=hdrs,
                timeout=aiohttp.ClientTimeout(total=timeout or self.cfg.search_timeout),
            ) as resp:
                status = resp.status
                # Manual line assembly: `async for` over resp.content iterates
                # readline() with a 64KB cap and raises ValueError('Chunk too
                # big') on long NDJSON lines (article text + brocardi easily
                # exceeds it). iter_chunked has no per-line limit.
                buf = b""
                async for chunk in resp.content.iter_chunked(1 << 16):
                    buf += chunk
                    while b"\n" in buf:
                        raw, buf = buf.split(b"\n", 1)
                        raw = raw.strip()
                        if raw:
                            try:
                                lines.append(jsonlib.loads(raw))
                            except ValueError:
                                pass
                tail = buf.strip()
                if tail:
                    try:
                        lines.append(jsonlib.loads(tail))
                    except ValueError:
                        pass
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            self.report.record("POST", url, None, (time.monotonic() - t0) * 1000,
                               False, f"ndjson error: {e!r}")
            if not self.record_only:
                raise StepFailure(f"NDJSON POST {url} failed: {e!r}")
            return []
        latency = (time.monotonic() - t0) * 1000
        ok = status == 200 and len(lines) >= 1
        self.report.record("POST", url, status, latency, ok,
                           f"{len(lines)} ndjson lines")
        if not ok and not self.record_only:
            raise StepFailure(f"NDJSON POST {url}: status={status}, lines={len(lines)}")
        return lines

    # ---- multipart upload (contrib documents) ----
    async def req_multipart(
        self,
        url: str,
        *,
        filepath: Path | None = None,
        filename: str | None = None,
        file_bytes: bytes | None = None,
        content_type: str = "text/plain",
        fields: dict[str, str] | None = None,
        expect: int | tuple[int, ...] = 201,
        timeout: float | None = None,
    ) -> tuple[int, Any]:
        form = aiohttp.FormData()
        if filepath is not None:
            file_bytes = filepath.read_bytes()
            filename = filename or filepath.name
        assert file_bytes is not None and filename is not None
        form.add_field("file", file_bytes, filename=filename, content_type=content_type)
        for k, v in (fields or {}).items():
            form.add_field(k, v)
        return await self.req("POST", url, data=form, expect=expect, timeout=timeout)

    # ---- generic poller ----
    async def poll(
        self,
        fn: Callable[[], Awaitable[Any]],
        until: Callable[[Any], bool],
        *,
        interval: float | None = None,
        max_wait: float = 120.0,
        label: str = "poll",
    ) -> Any:
        """Repeatedly awaits fn() until until(body) is truthy or max_wait
        elapses. Returns the last body; raises StepFailure on timeout."""
        interval = interval or self.cfg.poll_interval
        deadline = time.monotonic() + max_wait
        body: Any = None
        while time.monotonic() < deadline:
            body = await fn()
            if until(body):
                return body
            await asyncio.sleep(interval)
        if not self.record_only:
            raise StepFailure(f"{label}: not terminal after {max_wait}s",
                              {"last_body": _truncate(body)})
        return body

    # ---- auth helpers ----
    async def login(self, email: str, password: str) -> dict:
        status, body = await self.req(
            "POST", f"{self.cfg.bff}/auth/login",
            json={"email": email, "password": password}, auth=False,
        )
        self.access_token = body["access_token"]
        self.refresh_token = body.get("refresh_token", "")
        self.user_id = body["user"]["id"]
        return body["user"]

    async def refresh(self) -> None:
        _, body = await self.req(
            "POST", f"{self.cfg.bff}/auth/refresh",
            json={"refresh_token": self.refresh_token}, auth=False,
        )
        self.access_token = body["access_token"]
        self.refresh_token = body.get("refresh_token", self.refresh_token)

    async def admin_create_user(self, email: str, username: str, password: str,
                                is_admin: bool = False) -> dict:
        """Create an ACTIVE user via the admin API (register() would create an
        inactive one). Tolerates re-runs: on 400 'already exists' looks the
        user up via GET /admin/users."""
        status, body = await self.req(
            "POST", f"{self.cfg.bff}/admin/users",
            json={"email": email, "username": username, "password": password,
                  "isAdmin": is_admin, "isActive": True},
            expect=(201, 400),
        )
        if status == 201:
            return body
        # 400 -> assume duplicate from a previous run; look it up
        _, users = await self.req("GET", f"{self.cfg.bff}/admin/users")
        for u in users:
            if u.get("email") == email:
                return u
        raise StepFailure(f"admin_create_user: 400 but {email} not found in user list",
                          {"body": _truncate(body)})

    async def set_consent(self, level: str, reason: str = "e2e") -> dict:
        _, body = await self.req(
            "POST", f"{self.cfg.bff}/merlt/consent",
            json={"level": level, "reason": reason},
        )
        return body


def _truncate(body: Any, limit: int = 2000) -> Any:
    if isinstance(body, bytes):
        return f"<{len(body)} bytes>"
    if isinstance(body, str) and len(body) > limit:
        return body[:limit] + "...(truncated)"
    if isinstance(body, (dict, list)):
        s = jsonlib.dumps(body, ensure_ascii=False)
        if len(s) > limit:
            return s[:limit] + "...(truncated)"
    return body

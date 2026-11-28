"""An article read from Normattiva's fragment once its act is open (owner, G-652; T133).

An article page of a code weighs 2.6 MB, because it embeds the act's whole index, and Normattiva
takes about 2.5 s per MB: 1.4-6.6 s for an article of a code. The article alone (the fragment,
`/atto/caricaArticolo?…`) weighs 4-33 KB and comes in 0.2-0.5 s, and the extractor's text on it is
the text it gives on the whole page: identical, byte for byte, on all 29 Normattiva articles of the
timing harness (c.c., c.p.c., c.p., l. 241/1990, d.lgs. 231/2001, all of l. 24/2017), and so are the
update notes; the validity differs only in `act_updated`, which is in the whole page's head and is
taken from it (the index) instead.

The owner's rule: the first article of an act is read from the whole page, as before; the following
ones from the fragment. A fragment opens only in a session that has opened a page of the same act
(Normattiva keeps the act in the session: a fragment of another act is refused), so each act read
this way has a session of its own, with its own cookies, opened by that first whole page and kept a
while (`ActSessions`). The fragment's address is the current version's in that page's index
(`fragment_link`); any doubt — no single candidate, an article split into parts, a session gone, a
refused or unreadable answer, a page that is not the article — reads the whole page, as before.
"""
from __future__ import annotations

import asyncio
import html
import re
import time
from collections import OrderedDict
from typing import Optional

import aiohttp

from ..tools.config import HTTP_TIMEOUT
from .akn_parser import comparable_article_key
from .http_client import new_session

# How long an act's session is kept unused, and at most from its opening: the fragment's address
# comes from the index read then, so it is never older than this (a whole page in the cache can be
# a day old). How many are kept at once.
SESSION_IDLE_SECONDS = 15 * 60
SESSION_MAX_AGE_SECONDS = 15 * 60
MAX_SESSIONS = 32
# After this many fragments refused or not the article in a row, no fragment is asked for a while:
# if Normattiva changed, every article would otherwise cost one request more.
BREAKER_FAILURES = 5
BREAKER_PAUSE_SECONDS = 10 * 60

# Where a fragment's extras are kept beside it: the index it came from, `act_updated` read from that
# index, and the article's parts (always none: an article split into parts is never read this way).
FRAGMENT_MARK = "#frammento"

_ANCHOR = re.compile(
    r"""<a\b[^>]*onclick="return showArticle\('(/atto/caricaArticolo\?[^'<>\s]{1,2000})'[^>]*"""
    r"""class="numero_articolo"[^>]*>(.*?)</a>""", re.S)
_LABEL_PREFIX = re.compile(r"(?i)^art\.?\s*")


def fragment_meta_key(urn: str) -> str:
    return f"{urn}{FRAGMENT_MARK}"


def act_of(urn: str) -> Optional[str]:
    """The act's address in an article's URN («…;262:2~art2043» → «…;262:2»), or None."""
    if not isinstance(urn, str) or "~art" not in urn:
        return None
    return urn.split("~art", 1)[0]


def fragment_link(index_page: str, article: str) -> Optional[str]:
    """The path of `article`'s current version in a whole page's index, or None.

    The index labels the current version «art. 612 bis» (or «3», in an ordinary act) and the earlier
    ones «agg.N» and «orig.» (their links carry `imUpdate`). None unless exactly one link matches —
    an act whose body and annexes number their articles alike is read from the whole page — and
    None for an article the index splits into parts («1 (commi 1-100)»)."""
    if not isinstance(index_page, str) or not article:
        return None
    wanted = comparable_article_key(article)
    found = set()
    for path, label in _ANCHOR.findall(index_page):
        text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", label))).strip()
        if "imUpdate" in path or not re.match(r"(?i)^(?:art\.?\s*)?\d", text):
            continue
        number = _LABEL_PREFIX.sub("", text)
        if "commi" in number.lower():
            if comparable_article_key(number.split("(", 1)[0].strip()) == wanted:
                return None
            continue
        if comparable_article_key(number) == wanted:
            found.add(html.unescape(path))
    return next(iter(found)) if len(found) == 1 else None


class _ActSession:
    __slots__ = ("session", "index_key", "used_at", "opened_at", "loop")

    def __init__(self, session: aiohttp.ClientSession, index_key: str) -> None:
        self.session = session
        self.index_key = index_key
        self.used_at = self.opened_at = time.monotonic()
        self.loop = asyncio.get_running_loop()


class ActSessions:
    """The open acts: per act, the session its first whole page was read in and that page's key."""

    def __init__(self, idle: float = SESSION_IDLE_SECONDS, size: int = MAX_SESSIONS,
                 max_age: float = SESSION_MAX_AGE_SECONDS) -> None:
        self.idle, self.size, self.max_age = idle, size, max_age
        self._acts: "OrderedDict[str, _ActSession]" = OrderedDict()
        self._failures = 0
        self._paused_until = 0.0

    def paused(self) -> bool:
        """No fragment is asked while the breaker is open."""
        return time.monotonic() < self._paused_until

    def failed(self) -> None:
        self._failures += 1
        if self._failures >= BREAKER_FAILURES:
            self._paused_until = time.monotonic() + BREAKER_PAUSE_SECONDS
            self._failures = 0

    def succeeded(self) -> None:
        self._failures = 0

    def __len__(self) -> int:
        return len(self._acts)

    @staticmethod
    def new() -> aiohttp.ClientSession:
        return new_session(cookie_jar=aiohttp.CookieJar(), timeout=aiohttp.ClientTimeout(total=HTTP_TIMEOUT))

    def get(self, act: str) -> Optional[_ActSession]:
        entry = self._acts.get(act)
        if entry is None:
            return None
        now = time.monotonic()
        if (entry.loop is not asyncio.get_running_loop() or entry.session.closed
                or now - entry.used_at > self.idle or now - entry.opened_at > self.max_age):
            self.drop(act)
            return None
        entry.used_at = time.monotonic()
        self._acts.move_to_end(act)
        return entry

    def keep(self, act: str, session: aiohttp.ClientSession, index_key: str) -> bool:
        """Keep `session` as the act's, unless the act already has a live one: that one stays
        (fragments may be in flight in it) and False says the caller's is not kept."""
        if self.get(act) is not None:
            return False
        self._acts[act] = _ActSession(session, index_key)
        self._acts.move_to_end(act)
        while len(self._acts) > self.size:
            self.drop(next(iter(self._acts)))
        return True

    def drop(self, act: str, session: Optional[aiohttp.ClientSession] = None) -> None:
        """Forget the act's session (only if it is `session`, when given) and close it."""
        entry = self._acts.get(act)
        if entry is None or (session is not None and entry.session is not session):
            return
        del self._acts[act]
        if not entry.session.closed:
            _close_later(entry)

    async def close_all(self) -> None:
        entries = list(self._acts.values())
        self._acts.clear()
        for entry in entries:
            if not entry.session.closed and entry.loop is asyncio.get_running_loop():
                await entry.session.close()


def _close_later(entry: _ActSession) -> None:
    try:
        if entry.loop is asyncio.get_running_loop():
            asyncio.get_running_loop().create_task(entry.session.close())
    except RuntimeError:  # no running loop: the session goes with its loop
        pass

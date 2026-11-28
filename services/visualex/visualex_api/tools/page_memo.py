"""What a stored page says, computed once per page instead of once per read (T133).

Every read of a Normattiva article took its page (2.6 MB for an article of a code) from the
persistent cache three times and parsed it again for the validity, the update notes and the
parts: 36 of the 73 ms a warm read of an article of a code cost, and the reason the service
saturated at about 30 reads per second (docs/superpowers/specs/2026-11-28-collectors-speed-
design.md). The answer is a function of the page alone (and of the arguments named in the key),
so it is kept, in memory, under the page's identity: the persistent entry's write time
(`PersistentCache.stamp`). A page written again has a new stamp, and its answers are computed
afresh; an expired or missing page has no stamp, and the read goes the way it always went.

- **The same answer.** On a miss, the function runs on the page `get` returns, exactly as before;
  on a hit, the caller gets a copy of what it returned for that page: a Normattiva page's
  validity, notes and parts, and an EU article's text (`EurlexScraper._article_text`), which is
  kept exactly as the extractor returned it on the page with that stamp (rule 23: nothing is
  computed here that the extractor did not compute).
- **Bounded.** The least recently used answers go past `MAX_ENTRIES`; a restart empties the memo
  and the pages on disk fill it again without a request.
- **A backend without stamps** (Redis) reads the page every time, as before.
"""
from __future__ import annotations

import asyncio
import copy
from collections import OrderedDict
from typing import Any, Callable, Hashable, Optional

MAX_ENTRIES = 4096

_MISSING = object()


class PageMemo:
    def __init__(self, max_entries: int = MAX_ENTRIES) -> None:
        self.max_entries = max_entries
        self._answers: "OrderedDict[Hashable, Any]" = OrderedDict()

    def __len__(self) -> int:
        return len(self._answers)

    def clear(self) -> None:
        self._answers.clear()

    MISSING = _MISSING

    async def key_for(self, cache: Any, key: str, what: str, args: tuple) -> Optional[tuple]:
        """The name of an answer about the page `cache` holds under `key` now, or None when the
        page has no stamp (none, expired, a backend without stamps): then nothing is kept."""
        stamp_of = getattr(cache, "stamp", None)
        stamp: Optional[float] = await stamp_of(key) if stamp_of is not None else None
        if stamp is None:
            return None
        return (str(getattr(cache, "directory", id(cache))), key, stamp, what, args)

    def hit(self, memo_key: tuple) -> Any:
        """A copy of the answer kept under `memo_key`, or `MISSING`."""
        answer = self._answers.get(memo_key, _MISSING)
        if answer is _MISSING:
            return _MISSING
        self._answers.move_to_end(memo_key)
        return copy.deepcopy(answer)

    def put(self, memo_key: tuple, answer: Any) -> None:
        # A page written between the stamp and the read is the newer one; its answer stored
        # under the older stamp is never asked for again (that stamp is gone from disk).
        self._answers[memo_key] = copy.deepcopy(answer)
        self._answers.move_to_end(memo_key)
        while len(self._answers) > self.max_entries:
            self._answers.popitem(last=False)

    async def derive(
        self,
        cache: Any,
        key: str,
        what: str,
        args: tuple,
        compute: Callable[[str], Any],
    ) -> Any:
        """`compute(page)` for the page `cache` holds under `key`, run in a thread, or None when
        there is no page (not a string, or empty). `what` and `args` name the answer: two
        answers of one page differ by them."""
        memo_key = await self.key_for(cache, key, what, args)
        if memo_key is not None:
            answer = self.hit(memo_key)
            if answer is not _MISSING:
                return answer
        raw = await cache.get(key)
        if not isinstance(raw, str) or not raw:
            return None
        answer = await asyncio.to_thread(compute, raw)
        if memo_key is not None:
            self.put(memo_key, answer)
        return answer


PAGE_MEMO = PageMemo()

"""MERL-T consent payloads, as the web app sends them.

A level is chosen under the version of the MERL-T notice the person read: the
POST carries that notice's id (`noticeId`), read from GET /merlt/consent just
before. A notice that is no longer current is refused with 409, so the id must
come from the same answer the screen showed.
"""

from __future__ import annotations

from typing import Any


class NoticeMissing(RuntimeError):
    """GET /merlt/consent carried no notice to answer."""


def notice_id_from(consent: Any) -> str:
    """The id of the notice the consent answer carries, or NoticeMissing."""
    notice = consent.get("notice") if isinstance(consent, dict) else None
    notice_id = notice.get("id") if isinstance(notice, dict) else None
    if not isinstance(notice_id, str) or not notice_id:
        raise NoticeMissing("GET /merlt/consent gave no notice to answer")
    return notice_id


def consent_body(level: str, notice_id: str, reason: str = "e2e") -> dict[str, str]:
    """The body of POST /merlt/consent."""
    return {"level": level, "noticeId": notice_id, "reason": reason}

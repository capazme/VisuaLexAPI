"""The consent payload the harness sends: the notice id it read, as the screen does."""

import pytest

from e2e.consent import NoticeMissing, consent_body, notice_id_from

NOTICE = "3f2c9d1e-7a4b-4c8e-9f10-2b6d8e5a1c77"


def test_takes_the_id_of_the_notice_the_answer_carries():
    consent = {"level": "none", "noticeAnswered": False, "notice": {"id": NOTICE, "versione": 1}}
    assert notice_id_from(consent) == NOTICE


def test_refuses_an_answer_with_no_notice():
    with pytest.raises(NoticeMissing):
        notice_id_from({"level": "none", "notice": None})


def test_refuses_a_notice_without_an_id():
    with pytest.raises(NoticeMissing):
        notice_id_from({"notice": {"versione": 1}})


def test_body_carries_level_notice_and_reason():
    assert consent_body("basic", NOTICE, "e2e") == {"level": "basic", "noticeId": NOTICE, "reason": "e2e"}
